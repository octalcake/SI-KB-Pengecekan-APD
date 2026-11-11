package config

import (
	"bufio"
	"os"
	"strings"
	"testing"
)

// setExampleEnv loads .env.example into the test env, then applies overrides.
func setExampleEnv(t *testing.T, overrides map[string]string) {
	t.Helper()
	f, err := os.Open("../../.env.example")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	for s.Scan() {
		if k, v, ok := strings.Cut(s.Text(), "="); ok {
			t.Setenv(k, v)
		}
	}
	dir := t.TempDir()
	t.Setenv("DB_PATH", dir+"/k3.sqlite")
	t.Setenv("EVIDENCE_DIR", dir+"/evidence")
	t.Setenv("AI_INTERNAL_TOKEN", "test-token")
	t.Setenv("GEMINI_ENABLED", "false")
	for k, v := range overrides {
		t.Setenv(k, v)
	}
}

func TestLoad(t *testing.T) {
	cases := map[string]struct {
		env     map[string]string
		wantErr string
	}{
		"example values load":   {nil, ""},
		"placeholder token":     {map[string]string{"AI_INTERNAL_TOKEN": "isi-token"}, "AI_INTERNAL_TOKEN"},
		"gemini needs real key": {map[string]string{"GEMINI_ENABLED": "true"}, "GEMINI_API_KEY"},
		"loosened window":       {map[string]string{"CONFIRM_WINDOW_MS": "3000"}, "baseline"},
		"bad mode":              {map[string]string{"AI_MODE": "fake"}, "AI_MODE"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			setExampleEnv(t, tc.env)
			_, err := Load()
			if tc.wantErr == "" && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tc.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tc.wantErr)) {
				t.Fatalf("want error containing %q, got %v", tc.wantErr, err)
			}
		})
	}
}
