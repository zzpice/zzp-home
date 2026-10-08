package sitebuild

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image/png"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type Icon struct {
	Path     string `json:"path"`
	Title    string `json:"title"`
	Category string `json:"category"`
	SHA256   string `json:"sha256"`
	Size     int    `json:"size"`
}
type IconIndex struct {
	Repository string `json:"repository"`
	Revision   string `json:"revision"`
	Source     string `json:"source"`
	Icons      []Icon `json:"icons"`
}

func Digest(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func GenerateIcons(assets string) (IconIndex, error) {
	idx := IconIndex{Repository: "zzpice/assets", Source: "icons/SOURCES.md", Icons: []Icon{}}
	out, e := exec.Command("git", "-C", assets, "rev-parse", "HEAD").Output()
	if e != nil {
		return idx, e
	}
	idx.Revision = strings.TrimSpace(string(out))
	raw, e := os.ReadFile(filepath.Join(assets, "catalog.json"))
	if e != nil {
		return idx, e
	}
	var catalog struct {
		Assets []struct{ Path, Title, Kind, Category string }
	}
	if e = json.Unmarshal(raw, &catalog); e != nil {
		return idx, e
	}
	for _, a := range catalog.Assets {
		if a.Kind != "icon" {
			continue
		}
		b, e := os.ReadFile(filepath.Join(assets, a.Path))
		if e != nil {
			return idx, e
		}
		if e = CheckPNG(b); e != nil {
			return idx, fmt.Errorf("%s: %w", a.Path, e)
		}
		idx.Icons = append(idx.Icons, Icon{Path: a.Path, Title: a.Title, Category: a.Category, SHA256: Digest(b), Size: len(b)})
	}
	return idx, nil
}
func CheckPNG(b []byte) error {
	im, e := png.Decode(bytes.NewReader(b))
	if e != nil {
		return e
	}
	if im.Bounds().Dx() != 512 || im.Bounds().Dy() != 512 || len(b) < 26 || b[25] != 6 {
		return fmt.Errorf("要求 512×512 PNG / RGBA")
	}
	// The existing assets validator owns the precise r=115 raster mask. Check fully
	// transparent corner squares here; never transform the original image bytes.
	for _, p := range [][2]int{{0, 0}, {511, 0}, {0, 511}, {511, 511}} {
		_, _, _, a := im.At(p[0], p[1]).RGBA()
		if a != 0 {
			return fmt.Errorf("圆角外侧必须透明")
		}
	}
	return nil
}
func LoadIcons(root string) (IconIndex, error) {
	var idx IconIndex
	b, e := os.ReadFile(filepath.Join(root, "data/icons.json"))
	if e != nil {
		return idx, e
	}
	if e = json.Unmarshal(b, &idx); e != nil {
		return idx, e
	}
	if idx.Repository != "zzpice/assets" || !regexp.MustCompile(`^[a-f0-9]{40}$`).MatchString(idx.Revision) {
		return idx, fmt.Errorf("图标仓库与固定提交无效")
	}
	seen := map[string]bool{}
	for _, i := range idx.Icons {
		if !regexp.MustCompile(`^icons/[a-z0-9-]+/[a-z0-9-]+\.png$`).MatchString(i.Path) || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(i.SHA256) || seen[i.Path] {
			return idx, fmt.Errorf("无效图标索引")
		}
		seen[i.Path] = true
	}
	return idx, nil
}
func assetBytes(root, assets string, idx IconIndex, path, expected string) ([]byte, error) {
	if assets != "" {
		// A local checkout is an optimization, never a way to bypass the pinned hash.
		b, e := os.ReadFile(filepath.Join(assets, filepath.FromSlash(path)))
		if e != nil {
			return nil, e
		}
		if expected != "" && Digest(b) != expected {
			return nil, fmt.Errorf("本地图标与固定版本不符: %s", path)
		}
		return b, nil
	}
	cache := filepath.Join(root, ".cache/assets", idx.Revision, filepath.FromSlash(path))
	if b, e := os.ReadFile(cache); e == nil && (expected == "" || Digest(b) == expected) {
		return b, nil
	}
	client := http.Client{Timeout: 30 * time.Second}
	r, e := client.Get("https://raw.githubusercontent.com/" + idx.Repository + "/" + idx.Revision + "/" + path)
	if e != nil {
		return nil, e
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return nil, fmt.Errorf("assets %s: HTTP %d", path, r.StatusCode)
	}
	b, e := io.ReadAll(io.LimitReader(r.Body, 5<<20))
	if e != nil {
		return nil, e
	}
	if expected != "" && Digest(b) != expected {
		return nil, fmt.Errorf("图标 SHA-256 不匹配: %s", path)
	}
	if e = os.MkdirAll(filepath.Dir(cache), 0755); e != nil {
		return nil, e
	}
	if e = os.WriteFile(cache, b, 0644); e != nil {
		return nil, e
	}
	return b, nil
}
