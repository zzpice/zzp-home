package config

import (
	"encoding/json"
	"net/url"
	"os"
	"strings"
	"testing"
)

func realConfig(t *testing.T) Config {
	t.Helper()
	b, e := os.ReadFile("../../data/navigation.json")
	if e != nil {
		t.Fatal(e)
	}
	c, e := Decode(b)
	if e != nil {
		t.Fatal(e)
	}
	return c
}

// The published inventory is editable; only the configuration contract is fixed.
func TestNavigationConfig(t *testing.T) {
	c := realConfig(t)
	if _, err := Decode(Encode(c)); err != nil {
		t.Fatal(err)
	}
}

func fixtureConfig(t *testing.T) Config {
	t.Helper()
	b, err := os.ReadFile("../../tests/fixtures/navigation.json")
	if err != nil {
		t.Fatal(err)
	}
	c, err := Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestEditableInventory(t *testing.T) {
	c := fixtureConfig(t)
	for gi := range c.Groups {
		for si := range c.Groups[gi].Sites {
			c.Groups[gi].Sites[si].AlternateURLs = []string{}
			c.Groups[gi].Sites[si].Pinned = false
		}
	}
	c.Groups = c.Groups[:1]
	c.Groups[0].Sites = c.Groups[0].Sites[:1]
	if _, err := Decode(Encode(c)); err != nil {
		t.Fatal(err)
	}
	c.Groups[0].Sites = []Site{}
	if _, err := Decode(Encode(c)); err != nil {
		t.Fatal(err)
	}
	c.Groups = []Group{}
	if _, err := Decode(Encode(c)); err != nil {
		t.Fatal(err)
	}
}
func TestPinnedOrder(t *testing.T) {
	c := fixtureConfig(t)
	pins := c.PinnedSites()
	first := pins[0].ID
	last := 1999
	next := 0
	for gi := range c.Groups {
		for si := range c.Groups[gi].Sites {
			s := &c.Groups[gi].Sites[si]
			if s.Pinned {
				order := next
				s.PinOrder = &order
				next++
			}
			if s.ID == first {
				s.PinOrder = &last
			}
		}
	}
	if c.PinnedSites()[len(pins)-1].ID != first {
		t.Fatal("pin order ignored")
	}
	if c.Groups[0].Sites[0].ID != first {
		t.Fatal("category order changed")
	}
	roundTrip, err := Decode(Encode(c))
	if err != nil || roundTrip.PinnedSites()[len(pins)-1].ID != first {
		t.Fatal("pin order lost in JSON")
	}
	for _, value := range []string{"null", "-1", "1.5", "2001", `"1"`} {
		raw := strings.Replace(string(Encode(c)), `"pinOrder": 1999`, `"pinOrder": `+value, 1)
		if _, err := Decode([]byte(raw)); err == nil {
			t.Fatalf("accepted invalid pinOrder %s", value)
		}
	}
}
func TestCredentialURLValidation(t *testing.T) {
	for _, s := range []string{"javascript:alert(1)", "https://u:p@example.com/", "https://example.com/?token=example", "https://example.com/?%61pi=https%3A%2F%2Fexample.com%2Fprivate", "https://example.com/#access_token=test", "https://example.com/sub/abcdefghijklmnop", "https://example.com/?api_key=test"} {
		if URLProblem(s) == "" {
			t.Errorf("accepted credential or unsafe URL %s", s)
		}
	}
	for _, s := range []string{"http://192.168.100.57:8085/", "https://example.com/?locale=zh_CN&RL=1", "https://example.com/share/af6188ab-ce17-464b-b4eb-d907014e009f"} {
		if p := URLProblem(s); p != "" {
			t.Errorf("rejected safe URL %s: %s", s, p)
		}
	}
}
func TestApprovedSubStoreRouteRemainsPublic(t *testing.T) {
	approved := "http://192.168.100.57:3011?api=" + url.QueryEscape("http://192.168.100.57:3011/abcdefghijklmnopqrst")
	if problem := URLProblem(approved); problem != "" {
		t.Fatal("rejected approved LAN routing URL: " + problem)
	}
	if kept, notes := redactURL(approved); kept != approved || len(notes) != 0 {
		t.Fatal("approved URL must be retained byte-for-byte")
	}
	for _, rejected := range []string{
		approved + "&token=test",
		approved + "&api=" + url.QueryEscape("http://192.168.100.57:3011/abcdefghijklmnopqrst"),
		strings.Replace(approved, "192.168.100.57:3011?", "example.com:3011?", 1),
		"http://192.168.100.57:3011?api=" + url.QueryEscape("http://192.168.100.57:3011/abcdefghijklmnopqrst?token=test"),
		"http://192.168.100.57:3011?api=" + url.QueryEscape("http://192.168.100.57:3011/ghp_abcdefghijklmnop"),
	} {
		if URLProblem(rejected) == "" {
			t.Fatal("public routing exception must not permit other credentials")
		}
	}
	source := SunPanel{Version: 1, AppName: "Sun-Panel-Config", Icons: []SunGroup{{Title: "服务", Children: []SunSite{{Title: "Sub Store", URL: approved}}}}}
	raw, _ := json.Marshal(source)
	c, audit, e := Migrate(raw)
	if e != nil || audit.RedactedSites != 0 || c.Groups[1].Sites[0].URL != approved || c.Groups[1].Sites[0].Notice != "" || audit.Groups[0].Children[0].URL != approved {
		t.Fatal("migration must preserve the approved URL and omit redaction notices")
	}
}
func TestStrictConfig(t *testing.T) {
	c := fixtureConfig(t)
	b := Encode(c)
	if _, e := Decode(append(b, []byte(" {}")...)); e == nil {
		t.Fatal("accepted trailing JSON")
	}
	var v map[string]any
	json.Unmarshal(b, &v)
	v["credential"] = "example"
	b, _ = json.Marshal(v)
	if _, e := Decode(b); e == nil {
		t.Fatal("accepted unknown field")
	}
	c.Groups[0].Sites[1].ID = c.Groups[0].Sites[0].ID
	if c.Validate() == nil {
		t.Fatal("accepted duplicate ID")
	}
	for _, reserved := range []string{"pinned", "settings"} {
		c := fixtureConfig(t)
		c.Groups[0].ID = reserved
		if c.Validate() == nil {
			t.Fatal("accepted reserved view as group ID")
		}
	}
	if URLProblem("https://example.com/"+strings.Repeat("中", 700)) == "" {
		t.Fatal("accepted URL beyond UTF-8 byte limit")
	}
}
func TestRequiredFieldsDoNotBecomeSilentDefaults(t *testing.T) {
	for _, value := range []string{"missing", "null"} {
		var document map[string]any
		json.Unmarshal(Encode(fixtureConfig(t)), &document)
		site := document["groups"].([]any)[0].(map[string]any)["sites"].([]any)[0].(map[string]any)
		if value == "missing" {
			delete(site, "newTab")
		} else {
			site["pinned"] = nil
		}
		raw, _ := json.Marshal(document)
		if _, e := Decode(raw); e == nil {
			t.Fatalf("accepted %s boolean field", value)
		}
	}
}
func TestMigrationRetainsFieldsAndRedacts(t *testing.T) {
	source := SunPanel{Version: 1, AppName: "Sun-Panel-Config", AppVersion: "test", Icons: []SunGroup{{Title: "服务", Sort: 2, Children: []SunSite{
		{Title: "Sub Store", URL: "http://192.168.100.57:3011?api=http%3A%2F%2F192.168.100.57%3A3001%2Fexample-secret-route", Sort: 1, OpenMethod: 2, Icon: SunIcon{ItemType: 2, Src: "/uploads/missing.png"}},
		{Title: "S-UI", URL: "http://203.0.113.1:8080/owner-approved-panel", Sort: 2},
		{Title: "Emby", URL: "http://192.168.100.57:8096", LANURL: "https://example.com/emby", Sort: 3, Description: "direct", CardType: 1},
		{Title: "Emby", URL: "http://192.168.100.57:8097", Sort: 3, Description: "alternate"},
	}}, {Title: "常用", Sort: 1, CardStyle: json.RawMessage(`{"style":0,"textColor":"#ffffff","textInfoHideDescription":false,"textIconHideTitle":true}`), Children: []SunSite{{Title: "Test", URL: "https://example.com/?locale=zh_CN", Icon: SunIcon{ItemType: 1, Text: "测试"}}}}}}
	raw, _ := json.Marshal(source)
	c, m, e := Migrate(raw)
	if e != nil {
		t.Fatal(e)
	}
	if m.BeforeSites != 5 || m.AfterSites != 5 || m.AlternateLinks != 1 || m.RedactedSites != 1 {
		t.Fatalf("bad migration stats: %+v", m)
	}
	report, _ := json.Marshal(m)
	if strings.Contains(string(report), "example-secret-route") {
		t.Fatal("credential leaked to audit")
	}
	if c.Groups[0].Sites[0].URL != "https://example.com/?locale=zh_CN" {
		t.Fatal("normal query changed")
	}
	if !c.Groups[0].Sites[0].Pinned || c.Groups[0].Sites[0].IconText != "测试" {
		t.Fatal("lost original behavior")
	}
	if len(c.Groups[1].Sites) != 4 || c.Groups[1].Sites[2].Description != "direct" {
		t.Fatal("lost stable equal-sort order")
	}
	if c.Groups[1].Sites[1].URL != "http://203.0.113.1:8080/owner-approved-panel" || c.Groups[1].Sites[1].Notice != "" {
		t.Fatal("changed the owner's approved S-UI management URL")
	}
	if m.MissingLocalOriginals != 1 || m.RecoveredLocalOriginals != 0 {
		t.Fatal("missing original incorrectly reported as recovered")
	}
	_, recovered, e := MigrateWithSources(raw, map[string]string{"Sub Store": "icons/productivity/sub-store.png"}, map[string]bool{"/uploads/missing.png": true})
	if e != nil || recovered.MissingLocalOriginals != 0 || recovered.RecoveredLocalOriginals != 1 || recovered.Entries[1].OriginalIconStatus != "original-file-available" {
		t.Fatal("archive availability must be distinct from the selected replacement")
	}
}

func TestRetiredWallpaperMigration(t *testing.T) {
	c := fixtureConfig(t)
	c.Settings.Wallpaper = &Wallpaper{Mode: "bing", Path: ""}
	migrated, err := Decode(Encode(c))
	if err != nil {
		t.Fatal(err)
	}
	if migrated.Settings.Wallpaper.Mode != "daily" || migrated.Settings.Wallpaper.Path != "" {
		t.Fatal("retired wallpaper mode was not migrated")
	}
	migrated.Settings.Wallpaper = c.Settings.Wallpaper
	if string(Encode(migrated)) != string(Encode(c)) {
		t.Fatal("migration changed unrelated data")
	}
}
