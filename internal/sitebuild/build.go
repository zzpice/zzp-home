package sitebuild

import (
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/zzpice/zzp-home/internal/config"
)

type Project struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	URL         string `json:"url"`
	Kind        string `json:"kind"`
	Preview     string `json:"preview"`
	Icon        string `json:"icon"`
	Links       []struct {
		Title string `json:"title"`
		URL   string `json:"url"`
	} `json:"links"`
}
type BuildResult struct {
	Version string
	Files   int
	Bytes   int
}

func BlobSHA(raw []byte) string {
	h := sha1.New()
	fmt.Fprintf(h, "blob %d%c", len(raw), 0)
	h.Write(raw)
	return hex.EncodeToString(h.Sum(nil))
}
func Build(root, out, assets string) (BuildResult, error) {
	var result BuildResult
	raw, e := os.ReadFile(filepath.Join(root, "data/navigation.json"))
	if e != nil {
		return result, e
	}
	c, e := config.Decode(raw)
	if e != nil {
		return result, e
	}
	idx, e := LoadIcons(root)
	if e != nil {
		return result, e
	}
	projectRaw, e := os.ReadFile(filepath.Join(root, "data/projects.json"))
	if e != nil {
		return result, e
	}
	var projects []Project
	if e = json.Unmarshal(projectRaw, &projects); e != nil {
		return result, e
	}
	for _, p := range projects {
		if config.URLProblem(p.URL) != "" || config.ContainsCredential(p.Title+p.Description) {
			return result, fmt.Errorf("项目链接无效: %s", p.ID)
		}
		for _, l := range p.Links {
			if config.URLProblem(l.URL) != "" {
				return result, fmt.Errorf("项目次级链接无效: %s", p.ID)
			}
		}
	}
	files := map[string][]byte{}
	// White-list build inputs: no source export, audit, draft, or development files.
	entries, e := os.ReadDir(filepath.Join(root, "web"))
	if e != nil {
		return result, e
	}
	seed := append(append([]byte{}, raw...), projectRaw...)
	idxRaw, _ := json.Marshal(idx)
	seed = append(seed, idxRaw...)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		b, e := os.ReadFile(filepath.Join(root, "web", name))
		if e != nil {
			return result, e
		}
		seed = append(seed, []byte(name)...)
		seed = append(seed, b...)
		if strings.HasSuffix(name, ".js") || strings.HasSuffix(name, ".css") {
			files[name] = b
		}
	}
	static, e := os.ReadDir(filepath.Join(root, "icons"))
	if e != nil {
		return result, e
	}
	for _, f := range static {
		if f.IsDir() || f.Name() == "social-preview.png" {
			continue
		}
		b, e := os.ReadFile(filepath.Join(root, "icons", f.Name()))
		if e != nil {
			return result, e
		}
		files["brand/"+f.Name()] = b
		seed = append(seed, []byte(f.Name())...)
		seed = append(seed, b...)
	}
	// Include builder and worker logic so a behavior change always yields a new release.
	e = filepath.WalkDir(filepath.Join(root, "internal"), func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && strings.HasSuffix(p, ".go") && !strings.HasSuffix(p, "_test.go") {
			b, err := os.ReadFile(p)
			if err != nil {
				return err
			}
			seed = append(seed, b...)
		}
		return nil
	})
	if e != nil {
		return result, e
	}
	iconPaths := map[string]string{}
	iconByPath := map[string]Icon{}
	for _, i := range idx.Icons {
		iconByPath[i.Path] = i
	}
	used := map[string]bool{}
	for _, g := range c.Groups {
		for _, s := range g.Sites {
			if s.Icon != "" {
				used[s.Icon] = true
			}
		}
	}
	iconNames := []string{}
	for name := range used {
		if _, ok := iconByPath[name]; !ok {
			return result, fmt.Errorf("图标未登记: %s", name)
		}
		iconNames = append(iconNames, name)
	}
	sort.Strings(iconNames)
	images := make([][]byte, len(iconNames))
	errors := make([]error, len(iconNames))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 6)
	for i, name := range iconNames {
		wg.Add(1)
		go func(i int, name string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			images[i], errors[i] = assetBytes(root, assets, idx, name, iconByPath[name].SHA256)
			if errors[i] == nil {
				errors[i] = CheckPNG(images[i])
			}
		}(i, name)
	}
	wg.Wait()
	for _, err := range errors {
		if err != nil {
			return result, err
		}
	}
	atlas, css, e := Atlas(iconNames, images)
	if e != nil {
		return result, e
	}
	if len(atlas) > 0 {
		files["icons/atlas.png"] = atlas
		files["style.css"] = append(files["style.css"], css...)
	}
	for _, name := range iconNames {
		iconPaths[name] = "icons/atlas.png"
	}
	files["icons.json"] = idxRaw
	// Preserve upstream source records and license notices with derived deployment copies.
	for _, name := range []string{"icons/README.md", "icons/SOURCES.md", "icons/navigation-sources.json", "icons/licenses/oasisic-mit.txt", "icons/licenses/dashboard-icons-apache-2.0.txt", "icons/licenses/icongo-mit.txt", "icons/licenses/global-bank-logos-mit.txt", "icons/licenses/selfhst-cc-by-4.0.txt", "icons/licenses/simple-icons-cc0.txt"} {
		b, e := assetBytes(root, assets, idx, name, "")
		if e != nil {
			return result, e
		}
		files["attribution/"+strings.TrimPrefix(name, "icons/")] = b
	}
	// Bind the release to the actual derivative and attribution bytes as well as
	// source inputs, including differences between compiler or image encoders.
	fileNames := make([]string, 0, len(files))
	for name := range files {
		fileNames = append(fileNames, name)
	}
	sort.Strings(fileNames)
	for _, name := range fileNames {
		seed = append(seed, []byte(name)...)
		seed = append(seed, files[name]...)
	}
	version := Digest(seed)[:20]
	result.Version = version
	release := "r/" + version + "/"
	output := map[string][]byte{}
	for name, b := range files {
		output[release+name] = b
	}
	baseTemplate, e := os.ReadFile(filepath.Join(root, "web/shell.html"))
	if e != nil {
		return result, e
	}
	for _, page := range []string{"home", "projects"} {
		prefix := "./"
		route := "index.html"
		canonical := "https://zzp.moe/"
		if page == "projects" {
			prefix = "../"
			route = "projects/index.html"
			canonical += "projects/"
		}
		boot, _ := json.Marshal(map[string]any{"config": c, "blobSha": BlobSHA(raw), "release": version, "repository": "zzpice/zzp-home", "branch": "main", "configPath": "data/navigation.json", "iconPaths": iconPaths, "iconRevision": idx.Revision, "page": page})
		themeScript := fmt.Sprintf(`(()=>{let mode='shared';try{const v=localStorage.getItem('zzp-home-theme');if(['light','dark','system'].includes(v))mode=v}catch{}const shared=%q;const t=mode==='shared'?shared:mode;const dark=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.dataset.themeMode=mode})();`, c.Settings.Theme)
		sum := sha256.Sum256([]byte(themeScript))
		cspHash := base64.StdEncoding.EncodeToString(sum[:])
		funcs := template.FuncMap{
			"asset": func(s string) string { return prefix + release + s },
			"icon": func(s config.Site) string {
				if p := iconPaths[s.Icon]; p != "" {
					return prefix + release + p
				}
				return ""
			},
			"initial": func(s config.Site) string {
				if s.IconText != "" {
					return s.IconText
				}
				return string([]rune(strings.TrimSpace(s.Title))[0])
			},
			"tone": func(id string) int {
				n := 0
				for _, r := range id {
					n += int(r)
				}
				return n % 6
			},
			"target": func(s config.Site) string {
				if s.NewTab {
					return "_blank"
				}
				return "_self"
			},
		}
		t, e := template.New("shell").Funcs(funcs).Parse(string(baseTemplate))
		if e != nil {
			return result, e
		}
		pinned := []config.Site{}
		total := 0
		for _, g := range c.Groups {
			total += len(g.Sites)
			for _, s := range g.Sites {
				if s.Pinned {
					pinned = append(pinned, s)
				}
			}
		}
		var rendered strings.Builder
		data := map[string]any{"Config": c, "Projects": projects, "Page": page, "Prefix": prefix, "Version": version, "Canonical": canonical, "Bootstrap": template.JS(boot), "ThemeScript": template.JS(themeScript), "CSPHash": cspHash, "Pinned": pinned, "Total": total}
		if e = t.Execute(&rendered, data); e != nil {
			return result, e
		}
		output[route] = []byte(rendered.String())
	}
	output["CNAME"] = []byte("zzp.moe\n")
	output[".nojekyll"] = []byte{}
	manifest := map[string]any{"id": "https://zzp.moe/", "name": c.Settings.Title + " · 个人导航", "short_name": "ZZP", "lang": "zh-CN", "start_url": "./", "scope": "./", "display": "standalone", "background_color": "#f5f6f8", "theme_color": "#f5f6f8", "icons": []any{map[string]string{"src": "./" + release + "brand/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"}, map[string]string{"src": "./" + release + "brand/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"}}}
	output["manifest.webmanifest"], _ = json.Marshal(manifest)
	recovery, e := os.ReadFile(filepath.Join(root, "web/recovery.html"))
	if e != nil {
		return result, e
	}
	output["recovery.html"] = []byte(strings.ReplaceAll(string(recovery), "{{RELEASE}}", release))
	// The worker install manifest binds every cached response to this exact build.
	hashes := map[string]string{}
	for path, b := range output {
		if path == "CNAME" || path == ".nojekyll" {
			continue
		}
		hashes[path] = Digest(b)
	}
	manifestRaw, _ := json.Marshal(hashes)
	worker, e := os.ReadFile(filepath.Join(root, "web/worker.template"))
	if e != nil {
		return result, e
	}
	output["sw.js"] = []byte(strings.NewReplacer("__VERSION__", version, "__MANIFEST__", string(manifestRaw)).Replace(string(worker)))
	output["version.json"], _ = json.Marshal(map[string]any{"version": version, "blobSha": BlobSHA(raw)})
	absOut, _ := filepath.Abs(out)
	absRoot, _ := filepath.Abs(root)
	if absOut == absRoot || absOut == "/" || strings.HasPrefix(absRoot, absOut+string(os.PathSeparator)) {
		return result, fmt.Errorf("输出目录不可覆盖源代码")
	}
	stage := out + ".tmp"
	if e = os.RemoveAll(stage); e != nil {
		return result, e
	}
	names := make([]string, 0, len(output))
	for n := range output {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, name := range names {
		path := filepath.Join(stage, filepath.FromSlash(name))
		if e = os.MkdirAll(filepath.Dir(path), 0755); e != nil {
			return result, e
		}
		if e = os.WriteFile(path, output[name], 0644); e != nil {
			return result, e
		}
		result.Bytes += len(output[name])
		result.Files++
	}
	if e = os.RemoveAll(out); e != nil {
		return result, e
	}
	if e = os.Rename(stage, out); e != nil {
		return result, e
	}
	return result, nil
}
