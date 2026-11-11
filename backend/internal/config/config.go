// Package config loads the env contract from SRS §14.1.
package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"

	"k3/backend/internal/gemini"
)

type Config struct {
	AppEnv           string
	HTTPAddr         string
	AllowedHosts     []string
	AllowedOrigins   []string
	DBPath           string
	EvidenceDir      string
	AuthCookieName   string
	AuthTTL          time.Duration
	AuthCookieSecure bool

	SeedUsername    string
	SeedDisplayName string
	SeedPassword    string

	AIBaseURL           string
	AIInternalToken     string
	AITimeout           time.Duration
	FrameTotalDeadline  time.Duration
	FrameMaxBytes       int
	FrameMaxPixels      int
	FrameTargetFPS      int
	ConfirmHits         int
	ConfirmMaxFrames    int
	ConfirmWindow       time.Duration
	TrackTimeout        time.Duration
	SessionIdleTimeout  time.Duration
	AIMode              string
	AllowManualFallback bool

	GeminiEnabled       bool
	GeminiAPIKey        string
	GeminiModel         string
	GeminiAPIVersion    string
	GeminiTimeout       time.Duration
	GeminiMaxAttempts   int
	GeminiStore         bool
	ReportPromptVersion string
	DisplayTimezone     *time.Location
}

// Load reads .env (if present, never overriding real env) and validates it.
func Load() (*Config, error) {
	_ = godotenv.Load()
	r := &reader{}

	c := &Config{
		AppEnv:           r.str("APP_ENV"),
		HTTPAddr:         r.str("HTTP_ADDR"),
		AllowedHosts:     r.list("ALLOWED_HOSTS"),
		AllowedOrigins:   r.list("ALLOWED_ORIGINS"),
		DBPath:           r.str("DB_PATH"),
		EvidenceDir:      r.str("EVIDENCE_DIR"),
		AuthCookieName:   r.str("AUTH_COOKIE_NAME"),
		AuthTTL:          time.Duration(r.int("AUTH_TTL_HOURS")) * time.Hour,
		AuthCookieSecure: r.bool("AUTH_COOKIE_SECURE"),

		SeedUsername:    r.str("SEED_USERNAME"),
		SeedDisplayName: r.str("SEED_DISPLAY_NAME"),
		SeedPassword:    os.Getenv("SEED_PASSWORD"), // only checked by cmd/seed

		AIBaseURL:           r.str("AI_BASE_URL"),
		AIInternalToken:     r.secret("AI_INTERNAL_TOKEN"),
		AITimeout:           r.ms("AI_TIMEOUT_MS"),
		FrameTotalDeadline:  r.ms("FRAME_TOTAL_DEADLINE_MS"),
		FrameMaxBytes:       r.int("FRAME_MAX_BYTES"),
		FrameMaxPixels:      r.int("FRAME_MAX_PIXELS"),
		FrameTargetFPS:      r.int("FRAME_TARGET_FPS"),
		ConfirmHits:         r.int("CONFIRM_HITS"),
		ConfirmMaxFrames:    r.int("CONFIRM_MAX_FRAMES"),
		ConfirmWindow:       r.ms("CONFIRM_WINDOW_MS"),
		TrackTimeout:        r.ms("TRACK_TIMEOUT_MS"),
		SessionIdleTimeout:  r.ms("SESSION_IDLE_TIMEOUT_MS"),
		AIMode:              r.str("AI_MODE"),
		AllowManualFallback: r.bool("ALLOW_MANUAL_FALLBACK"),

		GeminiEnabled:       r.bool("GEMINI_ENABLED"),
		GeminiModel:         r.str("GEMINI_MODEL"),
		GeminiAPIVersion:    r.str("GEMINI_API_VERSION"),
		GeminiTimeout:       r.ms("GEMINI_TIMEOUT_MS"),
		GeminiMaxAttempts:   r.int("GEMINI_MAX_ATTEMPTS"),
		GeminiStore:         r.bool("GEMINI_STORE"),
		ReportPromptVersion: r.str("REPORT_PROMPT_VERSION"),
	}
	if c.GeminiEnabled {
		c.GeminiAPIKey = r.secret("GEMINI_API_KEY")
	}
	if tz := r.str("DISPLAY_TIMEZONE"); tz != "" {
		loc, err := time.LoadLocation(tz)
		if err != nil {
			r.fail("DISPLAY_TIMEZONE", "invalid timezone")
		}
		c.DisplayTimezone = loc
	}

	switch c.AIMode {
	case "real", "simulated", "manual":
	default:
		r.fail("AI_MODE", "must be real, simulated or manual")
	}
	// The stored prompt_version must name the prompt actually sent.
	if c.ReportPromptVersion != gemini.PromptVersion {
		r.fail("REPORT_PROMPT_VERSION", "must be "+gemini.PromptVersion)
	}
	// Temporal baseline is locked by SRS §2.1; do not loosen it silently.
	if c.ConfirmHits != 2 || c.ConfirmMaxFrames != 3 || c.ConfirmWindow != 2*time.Second || c.TrackTimeout != 5*time.Second {
		r.fail("CONFIRM_*/TRACK_TIMEOUT_MS", "must match baseline 2/3 in 2000ms, track timeout 5000ms")
	}

	if err := errors.Join(r.errs...); err != nil {
		return nil, err
	}
	for _, dir := range []string{filepath.Dir(c.DBPath), c.EvidenceDir} {
		if err := ensureWritable(dir); err != nil {
			return nil, err
		}
	}
	return c, nil
}

func ensureWritable(dir string) error {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("storage dir %s: %w", dir, err)
	}
	f, err := os.CreateTemp(dir, ".write-check-*")
	if err != nil {
		return fmt.Errorf("storage dir %s not writable: %w", dir, err)
	}
	f.Close()
	return os.Remove(f.Name())
}

type reader struct{ errs []error }

func (r *reader) fail(key, msg string) { r.errs = append(r.errs, fmt.Errorf("%s: %s", key, msg)) }

func (r *reader) str(key string) string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		r.fail(key, "required")
	}
	return v
}

// secret rejects empty values and the "isi-..." placeholders from .env.example.
func (r *reader) secret(key string) string {
	v := r.str(key)
	if strings.HasPrefix(v, "isi-") {
		r.fail(key, "still the .env.example placeholder")
	}
	return v
}

func (r *reader) list(key string) []string {
	parts := strings.Split(r.str(key), ",")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
}

func (r *reader) int(key string) int {
	v, err := strconv.Atoi(r.str(key))
	if err != nil || v <= 0 {
		r.fail(key, "must be a positive integer")
	}
	return v
}

func (r *reader) ms(key string) time.Duration { return time.Duration(r.int(key)) * time.Millisecond }

func (r *reader) bool(key string) bool {
	v, err := strconv.ParseBool(r.str(key))
	if err != nil {
		r.fail(key, "must be true or false")
	}
	return v
}
