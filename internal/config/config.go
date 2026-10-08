package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

type Config struct {
	SchemaVersion int      `json:"schemaVersion"`
	Settings      Settings `json:"settings"`
	Groups        []Group  `json:"groups"`
}
type Settings struct {
	Title            string `json:"title"`
	Subtitle         string `json:"subtitle"`
	Theme            string `json:"theme"`
	Layout           string `json:"layout"`
	Density          string `json:"density"`
	ShowDescriptions bool   `json:"showDescriptions"`
}
type Group struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Sites []Site `json:"sites"`
}
type Site struct {
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	Description   string   `json:"description"`
	URL           string   `json:"url"`
	AlternateURLs []string `json:"alternateUrls"`
	Icon          string   `json:"icon"`
	IconText      string   `json:"iconText"`
	Pinned        bool     `json:"pinned"`
	PinOrder      *int     `json:"pinOrder,omitempty"`
	NewTab        bool     `json:"newTab"`
	Tags          []string `json:"tags"`
	Notice        string   `json:"notice"`
}

var idPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)
var iconPattern = regexp.MustCompile(`^icons/[a-z0-9-]+/[a-z0-9-]+\.png$`)
var tokenPattern = regexp.MustCompile(`(?i)(github_pat_[a-z0-9_]{15,}|gh[pousr]_[a-z0-9]{15,}|bearer\s+[a-z0-9._-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)`)
var secretKey = regexp.MustCompile(`(?i)^(access[_-]?token|refresh[_-]?token|token|auth|authorization|password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|apikey|key|passkey|passcode|credential|api)$`)

func IsSecretKey(k string) bool        { return secretKey.MatchString(k) }
func ContainsCredential(s string) bool { return tokenPattern.MatchString(s) }

// The owner explicitly approved publishing this LAN Sub-Store API route.
// Keep the exception restricted to this deployment and an endpoint-only value;
// userinfo, actual credential formats and other authentication parameters remain blocked.
func publicSubStoreAPI(u *url.URL) bool {
	if u.Scheme != "http" || u.Host != "192.168.100.57:3011" || (u.Path != "" && u.Path != "/") || u.User != nil {
		return false
	}
	values := u.Query()["api"]
	if len(values) != 1 {
		return false
	}
	api, e := url.Parse(values[0])
	return e == nil && api.Scheme == u.Scheme && api.Host == u.Host && api.User == nil && api.RawQuery == "" && api.Fragment == "" && regexp.MustCompile(`^/[A-Za-z0-9_-]{20}$`).MatchString(api.Path)
}

func URLProblem(raw string) string {
	if len(raw) > 2048 || strings.TrimSpace(raw) != raw || strings.ContainsAny(raw, "\r\n\t") {
		return "链接长度或空白无效"
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.Opaque != "" {
		return "仅支持完整 HTTP / HTTPS 链接"
	}
	if u.User != nil {
		return "链接包含认证信息"
	}
	decoded := raw
	for i := 0; i < 3; i++ {
		d, e := url.QueryUnescape(decoded)
		if e != nil || d == decoded {
			break
		}
		decoded = d
	}
	if ContainsCredential(decoded) {
		return "链接包含疑似凭据"
	}
	for k := range u.Query() {
		if IsSecretKey(k) && !(k == "api" && publicSubStoreAPI(u)) {
			return "链接包含认证参数"
		}
	}
	if u.Fragment != "" {
		for k := range mustQuery(u.Fragment) {
			if IsSecretKey(k) {
				return "链接片段包含认证参数"
			}
		}
	}
	if regexp.MustCompile(`(?i)/(sub|subscribe|subscription)/[a-z0-9_-]{16,}`).MatchString(decoded) {
		return "链接包含疑似订阅凭据"
	}
	return ""
}
func mustQuery(s string) url.Values { v, _ := url.ParseQuery(strings.TrimPrefix(s, "?")); return v }
func Decode(raw []byte) (Config, error) {
	var c Config
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&c); err != nil {
		return c, fmt.Errorf("配置 JSON: %w", err)
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return c, errors.New("配置含多余 JSON 数据")
	}
	if err := requiredFields(raw); err != nil {
		return c, err
	}
	return c, c.Validate()
}
func (c Config) Validate() error {
	if c.SchemaVersion != 1 {
		return errors.New("仅支持 schemaVersion 1")
	}
	text := func(s string, max int, required bool) bool {
		return (!required || strings.TrimSpace(s) != "") && utf8.RuneCountInString(s) <= max && !ContainsCredential(s)
	}
	if !text(c.Settings.Title, 80, true) || !text(c.Settings.Subtitle, 200, false) {
		return errors.New("站点标题 / 副标题无效")
	}
	in := func(s string, a ...string) bool {
		for _, v := range a {
			if s == v {
				return true
			}
		}
		return false
	}
	if !in(c.Settings.Theme, "system", "light", "dark") || !in(c.Settings.Layout, "grid", "list") || !in(c.Settings.Density, "comfortable", "compact") {
		return errors.New("外观设置无效")
	}
	if len(c.Groups) > 100 {
		return errors.New("分类不能超过 100 个")
	}
	ids := map[string]bool{}
	count := 0
	for _, g := range c.Groups {
		if !idPattern.MatchString(g.ID) || ids[g.ID] || g.ID == "pinned" || g.ID == "settings" || !text(g.Title, 80, true) {
			return fmt.Errorf("分类 ID / 名称无效: %s", g.ID)
		}
		ids[g.ID] = true
		if g.Sites == nil {
			return fmt.Errorf("分类 %s 的 sites 必须是数组", g.ID)
		}
		for _, s := range g.Sites {
			count++
			if s.PinOrder != nil && (*s.PinOrder < 0 || *s.PinOrder > 2000) {
				return fmt.Errorf("网站 %s 的置顶顺序无效", s.ID)
			}
			if !idPattern.MatchString(s.ID) || ids[s.ID] || !text(s.Title, 120, true) || !text(s.Description, 500, false) || !text(s.IconText, 20, false) || !text(s.Notice, 200, false) {
				return fmt.Errorf("网站字段无效: %s", s.ID)
			}
			ids[s.ID] = true
			if p := URLProblem(s.URL); p != "" {
				return fmt.Errorf("网站 %s: %s", s.ID, p)
			}
			if s.AlternateURLs == nil || s.Tags == nil || len(s.AlternateURLs) > 10 || len(s.Tags) > 20 {
				return fmt.Errorf("网站 %s 的备用链接 / 标签必须是数组且在数量限制内", s.ID)
			}
			for _, u := range s.AlternateURLs {
				if p := URLProblem(u); p != "" {
					return fmt.Errorf("网站 %s 备用链接: %s", s.ID, p)
				}
			}
			for _, t := range s.Tags {
				if !text(t, 40, true) {
					return fmt.Errorf("网站 %s 标签无效", s.ID)
				}
			}
			if s.Icon != "" && !iconPattern.MatchString(s.Icon) {
				return fmt.Errorf("网站 %s 必须使用 assets 图标路径", s.ID)
			}
		}
	}
	if c.Groups == nil || count > 2000 {
		return errors.New("groups 必须是数组，网站最多 2000 个")
	}
	return nil
}
func Encode(c Config) []byte { b, _ := json.MarshalIndent(c, "", "  "); return append(b, '\n') }

func (c Config) PinnedSites() []Site {
	pinned := []Site{}
	for _, g := range c.Groups {
		for _, s := range g.Sites {
			if s.Pinned {
				pinned = append(pinned, s)
			}
		}
	}
	order := func(s Site) int {
		if s.PinOrder != nil {
			return *s.PinOrder
		}
		return 2000
	}
	sort.SliceStable(pinned, func(i, j int) bool { return order(pinned[i]) < order(pinned[j]) })
	return pinned
}

// Keep decoding strict and consistent with the browser: an omitted false or empty
// field is not silently interpreted as an intentional choice.
func requiredFields(raw []byte) error {
	require := func(b json.RawMessage, keys ...string) (map[string]json.RawMessage, error) {
		var object map[string]json.RawMessage
		if e := json.Unmarshal(b, &object); e != nil {
			return nil, e
		}
		for _, key := range keys {
			v, ok := object[key]
			if !ok || bytes.Equal(bytes.TrimSpace(v), []byte("null")) {
				return nil, fmt.Errorf("缺少配置字段: %s", key)
			}
		}
		return object, nil
	}
	root, e := require(raw, "schemaVersion", "settings", "groups")
	if e != nil {
		return e
	}
	if _, e = require(root["settings"], "title", "subtitle", "theme", "layout", "density", "showDescriptions"); e != nil {
		return e
	}
	var groups []json.RawMessage
	if e = json.Unmarshal(root["groups"], &groups); e != nil {
		return e
	}
	for _, group := range groups {
		g, e := require(group, "id", "title", "sites")
		if e != nil {
			return e
		}
		var sites []json.RawMessage
		if e = json.Unmarshal(g["sites"], &sites); e != nil {
			return e
		}
		for _, site := range sites {
			fields, e := require(site, "id", "title", "description", "url", "alternateUrls", "icon", "iconText", "pinned", "newTab", "tags", "notice")
			if e != nil {
				return e
			}
			if value, ok := fields["pinOrder"]; ok && bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
				return errors.New("pinOrder 不能为 null")
			}
		}
	}
	return nil
}
