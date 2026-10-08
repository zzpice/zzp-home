package config

import (
	"encoding/json"
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
func TestMigratedInventory(t *testing.T) {
	c := realConfig(t)
	count, alternates, pinned := 0, 0, 0
	names := map[string]int{}
	for _, g := range c.Groups {
		for _, s := range g.Sites {
			count++
			alternates += len(s.AlternateURLs)
			if s.Pinned {
				pinned++
			}
			names[s.Title]++
		}
	}
	if count != 91 || len(c.Groups) != 7 || alternates != 2 || pinned != 11 {
		t.Fatalf("inventory: %d sites, %d groups, %d alternate links, %d pinned", count, len(c.Groups), alternates, pinned)
	}
	for _, name := range []string{"飞牛 fnOS", "Emby", "SMBox"} {
		if names[name] != 2 {
			t.Fatalf("lost same-name endpoints: %s", name)
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
func TestStrictConfig(t *testing.T) {
	c := realConfig(t)
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
}
func TestRequiredFieldsDoNotBecomeSilentDefaults(t *testing.T) {
	for _, value := range []string{"missing", "null"} {
		var document map[string]any
		json.Unmarshal(Encode(realConfig(t)), &document)
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
		{Title: "S-UI", URL: "http://203.0.113.1:8080/example-secret-route", Sort: 2},
		{Title: "Emby", URL: "http://192.168.100.57:8096", LANURL: "https://example.com/emby", Sort: 3, Description: "direct", CardType: 1},
		{Title: "Emby", URL: "http://192.168.100.57:8097", Sort: 3, Description: "alternate"},
	}}, {Title: "常用", Sort: 1, CardStyle: json.RawMessage(`{"style":0,"textColor":"#ffffff","textInfoHideDescription":false,"textIconHideTitle":true}`), Children: []SunSite{{Title: "Test", URL: "https://example.com/?locale=zh_CN", Icon: SunIcon{ItemType: 1, Text: "测试"}}}}}}
	raw, _ := json.Marshal(source)
	c, m, e := Migrate(raw)
	if e != nil {
		t.Fatal(e)
	}
	if m.BeforeSites != 5 || m.AfterSites != 5 || m.AlternateLinks != 1 || m.RedactedSites != 2 {
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
	if m.MissingLocalOriginals != 1 || m.RecoveredLocalOriginals != 0 {
		t.Fatal("missing original incorrectly reported as recovered")
	}
	_, recovered, e := MigrateWithSources(raw, map[string]string{"Sub Store": "icons/productivity/sub-store.png"}, map[string]bool{"/uploads/missing.png": true})
	if e != nil || recovered.MissingLocalOriginals != 0 || recovered.RecoveredLocalOriginals != 1 || recovered.Entries[1].OriginalIconStatus != "original-file-available" {
		t.Fatal("archive availability must be distinct from the selected replacement")
	}
}
