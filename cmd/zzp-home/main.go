package main

import (
	"archive/zip"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/zzpice/zzp-home/internal/config"
	"github.com/zzpice/zzp-home/internal/sitebuild"
)

func writeJSON(path string, v any) error {
	b, e := json.MarshalIndent(v, "", "  ")
	if e != nil {
		return e
	}
	if e = os.MkdirAll(filepath.Dir(path), 0755); e != nil {
		return e
	}
	return os.WriteFile(path, append(b, '\n'), 0644)
}
func main() {
	if len(os.Args) < 2 {
		log.Fatal("用法: zzp-home build | validate | migrate | icons | check-links | serve")
	}
	if e := run(os.Args[1], os.Args[2:]); e != nil {
		log.Fatal(e)
	}
}
func run(command string, args []string) error {
	f := flag.NewFlagSet(command, flag.ContinueOnError)
	root := f.String("root", ".", "源代码目录")
	out := f.String("out", "build/pages", "输出目录 / 报告文件")
	assets := f.String("assets", "", "本地 assets checkout，可选")
	input := f.String("input", "", "原始 SunPanel JSON，仅本地读取")
	uploads := f.String("uploads", "", "SunPanel uploads.zip，仅本地读取")
	addr := f.String("addr", "127.0.0.1:4173", "预览地址")
	if e := f.Parse(args); e != nil {
		return e
	}
	switch command {
	case "build":
		r, e := sitebuild.Build(*root, *out, *assets)
		if e == nil {
			fmt.Printf("Build %s: %d files, %d bytes\n", r.Version, r.Files, r.Bytes)
		}
		return e
	case "validate":
		b, e := os.ReadFile(filepath.Join(*root, "data/navigation.json"))
		if e != nil {
			return e
		}
		c, e := config.Decode(b)
		if e != nil {
			return e
		}
		_, e = sitebuild.LoadIcons(*root)
		if e != nil {
			return e
		}
		n := 0
		for _, g := range c.Groups {
			n += len(g.Sites)
		}
		fmt.Printf("Valid: %d groups, %d sites\n", len(c.Groups), n)
		return nil
	case "migrate":
		b, e := os.ReadFile(*input)
		if e != nil {
			return e
		}
		aliases := map[string]string{}
		if a, err := os.ReadFile(filepath.Join(*root, "data/icon-aliases.json")); err == nil {
			if e = json.Unmarshal(a, &aliases); e != nil {
				return e
			}
		}
		available := map[string]bool{}
		if *uploads != "" {
			archive, err := zip.OpenReader(*uploads)
			if err != nil {
				return err
			}
			defer archive.Close()
			for _, file := range archive.File {
				if !file.FileInfo().IsDir() && !strings.Contains(file.Name, "..") && !strings.HasPrefix(file.Name, "/") {
					available["/uploads/"+strings.TrimPrefix(file.Name, "uploads/")] = true
				}
			}
		}
		c, m, e := config.MigrateWithSources(b, aliases, available)
		if e != nil {
			return e
		}
		if e = os.MkdirAll(filepath.Join(*root, "data"), 0755); e != nil {
			return e
		}
		if e = os.WriteFile(filepath.Join(*root, "data/navigation.json"), config.Encode(c), 0644); e != nil {
			return e
		}
		if e = writeJSON(filepath.Join(*root, "docs/migration-audit.json"), m); e != nil {
			return e
		}
		fmt.Printf("Migrated %d → %d sites; %d → %d groups; %d alternate links; %d redacted sites; %d assets replacements / %d unassigned images\n", m.BeforeSites, m.AfterSites, m.BeforeGroups, m.AfterGroups, m.AlternateLinks, m.RedactedSites, m.ReusedIcons, m.UnresolvedIcons)
		return nil
	case "icons":
		idx, e := sitebuild.GenerateIcons(*assets)
		if e != nil {
			return e
		}
		if e = writeJSON(filepath.Join(*root, "data/icons.json"), idx); e != nil {
			return e
		}
		fmt.Printf("Indexed %d assets icons at %s\n", len(idx.Icons), idx.Revision)
		return nil
	case "check-links":
		return checkLinks(*root, *out)
	case "serve":
		fmt.Printf("Preview http://%s\n", *addr)
		return http.ListenAndServe(*addr, http.FileServer(http.Dir(*out)))
	default:
		return fmt.Errorf("未知命令 %s", command)
	}
}
func checkLinks(root, out string) error {
	b, e := os.ReadFile(filepath.Join(root, "data/navigation.json"))
	if e != nil {
		return e
	}
	c, e := config.Decode(b)
	if e != nil {
		return e
	}
	type Check struct {
		ID     string `json:"id"`
		URL    string `json:"url"`
		Status int    `json:"status,omitempty"`
		Result string `json:"result"`
	}
	checks := []Check{}
	for _, g := range c.Groups {
		for _, s := range g.Sites {
			checks = append(checks, Check{ID: s.ID, URL: s.URL})
			for _, a := range s.AlternateURLs {
				checks = append(checks, Check{ID: s.ID, URL: a})
			}
		}
	}
	sem := make(chan struct{}, 6)
	var wg sync.WaitGroup
	client := http.Client{Timeout: 12 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return http.ErrUseLastResponse
		}
		u := req.URL
		if config.URLProblem(u.String()) != "" {
			return http.ErrUseLastResponse
		}
		if ip := net.ParseIP(u.Hostname()); ip != nil && (ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast()) {
			return http.ErrUseLastResponse
		}
		return nil
	}}
	for i := range checks {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			u, _ := url.Parse(checks[i].URL)
			if ip := net.ParseIP(u.Hostname()); ip != nil && (ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast()) {
				checks[i].Result = "内网：需在所属网络人工验证"
				return
			}
			sem <- struct{}{}
			defer func() { <-sem }()
			req, _ := http.NewRequest("HEAD", checks[i].URL, nil)
			req.Header.Set("User-Agent", "ZZP-Link-Audit/1.0")
			r, e := client.Do(req)
			if e != nil {
				checks[i].Result = "网络 / TLS / 超时：不能据此判定失效"
				return
			}
			r.Body.Close()
			checks[i].Status = r.StatusCode
			switch {
			case r.StatusCode < 400:
				checks[i].Result = "HTTP 可响应（未验证登录后内容）"
			case r.StatusCode == 401 || r.StatusCode == 403 || r.StatusCode == 429:
				checks[i].Result = "认证 / 访问限制：人工验证"
			default:
				checks[i].Result = "HTTP 异常：人工验证，不自动删除"
			}
		}(i)
	}
	wg.Wait()
	return writeJSON(out, map[string]any{"checkedAt": time.Now().UTC().Format(time.RFC3339), "method": "HEAD; timeout 12s; no private network requests; redirects limited to 5", "checks": checks})
}
