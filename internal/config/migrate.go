package config

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"sort"
	"strings"
)

type SunPanel struct {
	Version    int        `json:"version"`
	AppName    string     `json:"appName"`
	ExportTime string     `json:"exportTime"`
	AppVersion string     `json:"appVersion"`
	MD5        string     `json:"md5"`
	Icons      []SunGroup `json:"icons"`
}
type SunGroup struct {
	Title     string          `json:"title"`
	Sort      int             `json:"sort"`
	Children  []SunSite       `json:"children"`
	CardStyle json.RawMessage `json:"cardStyle"`
}
type SunSite struct {
	Icon            SunIcon        `json:"icon"`
	Sort            int            `json:"sort"`
	Title           string         `json:"title"`
	URL             string         `json:"url"`
	LANURL          string         `json:"lanUrl"`
	Description     string         `json:"description"`
	OpenMethod      int            `json:"openMethod"`
	CardType        int            `json:"cardType"`
	BackgroundColor string         `json:"backgroundColor"`
	ExpandParam     map[string]any `json:"expandParam"`
}
type SunIcon struct {
	ItemType        int    `json:"itemType"`
	Src             string `json:"src"`
	Text            string `json:"text"`
	BackgroundColor string `json:"backgroundColor"`
}
type Migration struct {
	RecoveredLocalOriginals   int              `json:"recoveredLocalOriginals"`
	SourceSHA256              string           `json:"sourceSHA256"`
	SourceVersion             string           `json:"sourceVersion"`
	ExportTime                string           `json:"exportTime"`
	BeforeSites               int              `json:"beforeSites"`
	AfterSites                int              `json:"afterSites"`
	BeforeGroups              int              `json:"beforeGroups"`
	AfterGroups               int              `json:"afterGroups"`
	AlternateLinks            int              `json:"alternateLinks"`
	RedactedSites             int              `json:"redactedSites"`
	ReusedIcons               int              `json:"reusedIcons"`
	UnresolvedIcons           int              `json:"unresolvedIcons"`
	MissingLocalOriginals     int              `json:"missingLocalOriginals"`
	UnrestoredRemoteOriginals int              `json:"unrestoredRemoteOriginals"`
	OriginalTextIcons         int              `json:"originalTextIcons"`
	Groups                    []SunGroup       `json:"sourceGroups"`
	Entries                   []MigrationEntry `json:"entries"`
}
type MigrationEntry struct {
	ID                 string   `json:"id"`
	SourceGroup        string   `json:"sourceGroup"`
	Destination        string   `json:"destination"`
	OriginalSort       int      `json:"originalSort"`
	IconStatus         string   `json:"iconStatus"`
	OriginalIconStatus string   `json:"originalIconStatus"`
	Notes              []string `json:"notes"`
}

func Migrate(raw []byte) (Config, Migration, error) { return MigrateWithIcons(raw, nil) }
func MigrateWithIcons(raw []byte, aliases map[string]string) (Config, Migration, error) {
	return MigrateWithSources(raw, aliases, nil)
}
func MigrateWithSources(raw []byte, aliases map[string]string, available map[string]bool) (Config, Migration, error) {
	var source SunPanel
	var m Migration
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.DisallowUnknownFields()
	if err := d.Decode(&source); err != nil {
		return Config{}, m, err
	}
	if source.Version != 1 || source.AppName != "Sun-Panel-Config" {
		return Config{}, m, fmt.Errorf("不支持的 SunPanel 导出")
	}
	c := Config{SchemaVersion: 1, Settings: Settings{Title: "ZZP", Subtitle: "常用网站、自己的服务，还有喜欢的互联网。", Theme: "system", Layout: "grid", Density: "comfortable", ShowDescriptions: true}, Groups: []Group{}}
	titles := []string{"日常与学习", "设备与自托管", "社区与开发", "影音与资源", "网络与云服务", "金融服务", "成人内容"}
	groupIDs := []string{"daily", "self-hosted", "community", "media", "network", "finance", "adult"}
	for i, t := range titles {
		c.Groups = append(c.Groups, Group{ID: groupIDs[i], Title: t, Sites: []Site{}})
	}
	mapping := map[string]int{"常用": 0, "学习": 0, "服务": 1, "论坛": 2, "多媒体下载": 3, "PT站": 3, "云服务器": 4, "网络工具": 4, "机场": 4, "域名服务商": 4, "不可描述": 6}
	iconMap := map[string]string{"InteractiveBrokers": "icons/finance/interactive-brokers.png", "Charles Schwab": "icons/finance/charles-schwab.png", "Emby": "icons/media-players/emby.png", "Github": "icons/development/github.png", "GitHub 文件加速": "icons/development/github.png"}
	for title, path := range aliases {
		iconMap[title] = path
	}
	hash := sha256.Sum256(raw)
	m.SourceSHA256 = hex.EncodeToString(hash[:])
	m.SourceVersion = source.AppVersion
	m.ExportTime = source.ExportTime
	m.BeforeGroups = len(source.Icons)
	// Stable sort keeps the original array order when SunPanel uses equal sort numbers.
	sort.SliceStable(source.Icons, func(i, j int) bool { return source.Icons[i].Sort < source.Icons[j].Sort })
	for gi, g := range source.Icons {
		dst, ok := mapping[g.Title]
		if !ok {
			return c, m, fmt.Errorf("未审查的新分类: %s", g.Title)
		}
		sort.SliceStable(g.Children, func(i, j int) bool { return g.Children[i].Sort < g.Children[j].Sort })
		for si, s := range g.Children {
			m.BeforeSites++
			id := fmt.Sprintf("sp-%02d-%03d", gi+1, si+1)
			target := dst
			if s.Title == "InteractiveBrokers" || s.Title == "Charles Schwab" {
				target = 5
			}
			if s.Title == "GitHub 文件加速" {
				target = 4
			}
			entry := MigrationEntry{ID: id, SourceGroup: g.Title, Destination: titles[target], OriginalSort: s.Sort, Notes: []string{}}
			safe, notes := redactURL(s.URL, s.Title)
			redacted := len(notes) > 0
			s.URL = safe
			entry.Notes = append(entry.Notes, notes...)
			alt := []string{}
			if s.LANURL != "" {
				s.LANURL, notes = redactURL(s.LANURL, s.Title)
				redacted = redacted || len(notes) > 0
				alt = append(alt, s.LANURL)
				entry.Notes = append(entry.Notes, notes...)
				m.AlternateLinks++
			}
			tags := []string{}
			u, _ := url.Parse(safe)
			if ip := net.ParseIP(u.Hostname()); ip != nil && ip.IsPrivate() {
				tags = append(tags, "内网")
			}
			if g.Title == "PT站" {
				tags = append(tags, "PT")
			}
			icon := iconMap[s.Title]
			text := s.Icon.Text
			if s.Icon.ItemType == 1 {
				entry.OriginalIconStatus = "original-text"
				m.OriginalTextIcons++
			} else if available[s.Icon.Src] {
				entry.OriginalIconStatus = "original-file-available"
				m.RecoveredLocalOriginals++
				entry.Notes = append(entry.Notes, "原始归档文件已匹配；是否采用由图标质量审查决定")
			} else if strings.HasPrefix(s.Icon.Src, "/uploads/") {
				entry.OriginalIconStatus = "missing-local-original"
				m.MissingLocalOriginals++
				entry.Notes = append(entry.Notes, "缺少 SunPanel uploads 原始图片；assets 图标为替代素材，并非原图恢复")
			} else {
				entry.OriginalIconStatus = "unrestored-remote-original"
				m.UnrestoredRemoteOriginals++
				entry.Notes = append(entry.Notes, "原远程图标未恢复；替代素材另有来源记录")
			}
			switch {
			case icon != "":
				entry.IconStatus = "replaced-with-assets"
				m.ReusedIcons++
			case s.Icon.ItemType == 1:
				entry.IconStatus = "original-text"
			default:
				entry.IconStatus = "missing-original-image"
				m.UnresolvedIcons++
				if strings.HasPrefix(s.Icon.Src, "/uploads/") {
					entry.Notes = append(entry.Notes, "缺少 SunPanel uploads 原始图片")
				} else {
					entry.Notes = append(entry.Notes, "原远程图标路径异常，未恢复")
				}
			}
			notice := ""
			if redacted {
				notice = "认证部分已移除，请确认安全入口"
				m.RedactedSites++
			}
			c.Groups[target].Sites = append(c.Groups[target].Sites, Site{ID: id, Title: s.Title, Description: s.Description, URL: safe, AlternateURLs: alt, Icon: icon, IconText: text, Pinned: g.Title == "常用", NewTab: s.OpenMethod == 2, Tags: tags, Notice: notice})
			// Archive all understood display fields, but never retain the original credential URL.
			g.Children[si] = s
			m.Entries = append(m.Entries, entry)
		}
		m.Groups = append(m.Groups, g)
	}
	m.AfterGroups = len(c.Groups)
	for _, g := range c.Groups {
		m.AfterSites += len(g.Sites)
	}
	b, _ := json.Marshal(m)
	if ContainsCredential(string(b)) {
		return c, m, fmt.Errorf("迁移审计仍含疑似凭据")
	}
	return c, m, c.Validate()
}
func redactURL(raw, title string) (string, []string) {
	notes := []string{}
	u, e := url.Parse(raw)
	if e != nil {
		return raw, notes
	}
	if u.User != nil {
		u.User = nil
		notes = append(notes, "移除 URL userinfo")
	}
	q := u.Query()
	for k := range q {
		if IsSecretKey(k) {
			q.Del(k)
			notes = append(notes, "移除认证参数 "+k)
		}
	}
	if len(notes) > 0 {
		u.RawQuery = q.Encode()
	}
	if title == "S-UI" && u.Path != "" && u.Path != "/" {
		u.Path = "/"
		u.RawPath = ""
		notes = append(notes, "移除不透明的管理面板路径")
	}
	return u.String(), notes
}
