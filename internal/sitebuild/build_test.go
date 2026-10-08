package sitebuild

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/zzpice/zzp-home/internal/config"
)

func TestBlobSHA(t *testing.T) {
	if BlobSHA([]byte("test\n")) != "9daeafb9864cf43055ae93beb0afd6c7d144bfa4" {
		t.Fatal("blob SHA must match Git")
	}
}
func TestBuildDeterminismAndWhitelist(t *testing.T) {
	root := "../.."
	out := filepath.Join(t.TempDir(), "pages")
	first, e := Build(root, out, os.Getenv("ASSETS_DIR"))
	if e != nil {
		t.Fatal(e)
	}
	html, e := os.ReadFile(filepath.Join(out, "index.html"))
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Contains(html, []byte(`id="bootstrap"`)) {
		t.Fatal("missing prerender / data snapshot")
	}
	match := regexp.MustCompile(`<script[^>]*id="bootstrap"[^>]*>([^<]*)</script>`).FindSubmatch(html)
	if len(match) != 2 {
		t.Fatal("missing parseable bootstrap snapshot")
	}
	var bootstrap struct {
		Config json.RawMessage `json:"config"`
	}
	if e = json.Unmarshal(match[1], &bootstrap); e != nil {
		t.Fatal(e)
	}
	snapshot, e := config.Decode(bootstrap.Config)
	if e != nil {
		t.Fatal(e)
	}
	sourceBytes, _ := os.ReadFile(filepath.Join(root, "data/navigation.json"))
	source, e := config.Decode(sourceBytes)
	if e != nil || !bytes.Equal(config.Encode(source), config.Encode(snapshot)) {
		t.Fatal("prerender must preserve complete approved URLs and configuration")
	}
	for _, group := range source.Groups {
		for _, site := range group.Sites {
			visible := bytes.Contains(html, []byte(`data-site="`+site.ID+`"`))
			adult := group.ID == "adult" || strings.HasPrefix(site.Icon, "icons/adult/")
			if visible == adult {
				t.Fatalf("incorrect default visibility for %s", site.ID)
			}
		}
	}
	second, e := Build(root, out, os.Getenv("ASSETS_DIR"))
	if e != nil {
		t.Fatal(e)
	}
	if first != second {
		t.Fatal("nondeterministic build")
	}
	newHTML, _ := os.ReadFile(filepath.Join(out, "index.html"))
	if !bytes.Equal(html, newHTML) {
		t.Fatal("HTML changed between identical builds")
	}
	for _, name := range []string{"docs", "data", "web", "scripts", "node_modules", "AGENTS.md", "README.md", "SunPanel-Data202610081938.sun-panel.json"} {
		if _, e := os.Stat(filepath.Join(out, name)); !os.IsNotExist(e) {
			t.Fatalf("published non-public build input %s", name)
		}
	}
	worker, _ := os.ReadFile(filepath.Join(out, "sw.js"))
	if !bytes.Contains(worker, []byte(first.Version)) || bytes.Contains(worker, []byte("__MANIFEST__")) {
		t.Fatal("worker manifest not generated")
	}
	var manifest map[string]any
	b, _ := os.ReadFile(filepath.Join(out, "manifest.webmanifest"))
	if e = json.Unmarshal(b, &manifest); e != nil {
		t.Fatal(e)
	}
	if manifest["id"] != "https://zzp.moe/" {
		t.Fatal("installation identity changed")
	}
	filepath.WalkDir(out, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			t.Fatal(err)
		}
		if !d.IsDir() && (strings.HasSuffix(path, ".json") || strings.HasSuffix(path, ".html")) {
			b, _ := os.ReadFile(path)
			if config.ContainsCredential(string(b)) {
				t.Fatalf("credential format in %s", path)
			}
		}
		return nil
	})
}
