package storage

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestQuarantine(t *testing.T) {
	root := filepath.Join(t.TempDir(), "evidence")
	e, _ := NewEvidence(root)
	if n, err := e.Quarantine(nil); n != 0 || err != nil {
		t.Fatalf("missing root: %d %v", n, err)
	}
	kept, err := e.Save([]byte("a"), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	orphan, _ := e.Save([]byte("b"), time.Now())
	tmp := filepath.Join(filepath.Dir(filepath.Join(root, filepath.FromSlash(kept))), ".tmp-123")
	os.WriteFile(tmp, []byte("c"), 0o600)

	n, err := e.Quarantine(map[string]bool{kept: true})
	if err != nil || n != 2 {
		t.Fatalf("quarantine: %d %v", n, err)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(kept))); err != nil {
		t.Fatal("referenced file must stay")
	}
	if _, err := os.Stat(filepath.Join(root, "quarantine", filepath.FromSlash(orphan))); err != nil {
		t.Fatal("orphan must move to quarantine")
	}
	if n, _ := e.Quarantine(map[string]bool{kept: true}); n != 0 {
		t.Fatalf("quarantine dir must not be rescanned, moved %d", n)
	}
}
