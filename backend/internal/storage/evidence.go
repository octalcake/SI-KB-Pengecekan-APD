// Package storage writes evidence JPEGs under EVIDENCE_DIR (SRS §6.6).
package storage

import (
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Evidence struct{ root string }

func NewEvidence(root string) (*Evidence, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	return &Evidence{root: abs}, nil
}

// Save writes data to YYYY/MM/<uuid>.jpg via temp file + atomic rename and
// returns the slash-separated path relative to the root.
func (e *Evidence) Save(data []byte, at time.Time) (string, error) {
	rel := fmt.Sprintf("%04d/%02d/%s.jpg", at.Year(), at.Month(), NewUUID())
	dst := filepath.Join(e.root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(dst), 0o750); err != nil {
		return "", err
	}
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".tmp-*")
	if err != nil {
		return "", err
	}
	_, werr := tmp.Write(data)
	serr := tmp.Sync()
	cerr := tmp.Close()
	if err := errors.Join(werr, serr, cerr); err != nil {
		os.Remove(tmp.Name())
		return "", err
	}
	if err := os.Rename(tmp.Name(), dst); err != nil {
		os.Remove(tmp.Name())
		return "", err
	}
	return rel, nil
}

// Path resolves a stored relative path and refuses anything outside the root.
func (e *Evidence) Path(rel string) (string, error) {
	p := filepath.Join(e.root, filepath.FromSlash(rel))
	if !strings.HasPrefix(p, e.root+string(filepath.Separator)) {
		return "", errors.New("evidence path outside storage root")
	}
	return p, nil
}

func (e *Evidence) Remove(rel string) {
	if p, err := e.Path(rel); err == nil {
		os.Remove(p)
	}
}

const quarantineDir = "quarantine"

// Quarantine moves files that no finding references (orphans from a crash between
// file write and DB insert, or leftover .tmp-* files) to <root>/quarantine/<rel>.
// Nothing is deleted (SRS §6.6). Returns how many files were moved.
func (e *Evidence) Quarantine(known map[string]bool) (int, error) {
	var orphans []string
	err := filepath.WalkDir(e.root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) && p == e.root {
				return filepath.SkipAll // no evidence written yet
			}
			return err
		}
		rel, _ := filepath.Rel(e.root, p)
		rel = filepath.ToSlash(rel)
		if d.IsDir() {
			if rel == quarantineDir {
				return filepath.SkipDir
			}
			return nil
		}
		if !known[rel] {
			orphans = append(orphans, rel)
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	for i, rel := range orphans {
		dst := filepath.Join(e.root, quarantineDir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dst), 0o750); err != nil {
			return i, err
		}
		if err := os.Rename(filepath.Join(e.root, filepath.FromSlash(rel)), dst); err != nil {
			return i, err
		}
	}
	return len(orphans), nil
}

// NewUUID returns a random RFC 4122 v4 UUID.
func NewUUID() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
