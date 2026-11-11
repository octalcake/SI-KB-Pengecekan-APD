// Package gemini drafts report narratives via the Interactions API (SRS §13).
// Only Go holds the API key; Gemini never sees photos or track IDs.
package gemini

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const BaseURL = "https://generativelanguage.googleapis.com"

type Detail struct {
	FindingRef  string `json:"finding_ref"`
	Observation string `json:"observation"`
	FollowUp    string `json:"follow_up"`
}

// Narrative is the model's JSON text after extraction from the provider envelope.
type Narrative struct {
	Title              string   `json:"title"`
	Summary            string   `json:"summary"`
	Details            []Detail `json:"details"`
	MissingInformation []string `json:"missing_information"`
}

// Generator is the boundary swapped by a fake in tests.
type Generator interface {
	Generate(ctx context.Context, input []byte) (*Narrative, error)
	Model() string
}

// UnavailableError: provider failed or timed out (→ 503 GEMINI_UNAVAILABLE).
type UnavailableError struct{ Reason string }

func (e *UnavailableError) Error() string { return "gemini unavailable: " + e.Reason }

// InvalidOutputError: provider answered but output breaks the contract (→ 502).
type InvalidOutputError struct{ Reason string }

func (e *InvalidOutputError) Error() string { return "invalid gemini output: " + e.Reason }

type Client struct {
	BaseURL     string
	APIKey      string
	ModelName   string
	APIVersion  string
	Timeout     time.Duration
	MaxAttempts int
	HC          *http.Client
}

func (c *Client) Model() string { return c.ModelName }

func (c *Client) Generate(ctx context.Context, input []byte) (*Narrative, error) {
	body, err := json.Marshal(map[string]any{
		"model":              c.ModelName,
		"store":              false,
		"system_instruction": SystemPrompt,
		"input":              "DATA_TEMUAN:\n" + string(input),
		"response_format":    map[string]any{"type": "text", "mime_type": "application/json", "schema": schema},
	})
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, c.Timeout)
	defer cancel()

	var lastErr error
	for attempt := 1; attempt <= c.MaxAttempts; attempt++ {
		text, retryAfter, err := c.call(ctx, body)
		if err == nil {
			var n Narrative
			if err := json.Unmarshal([]byte(text), &n); err != nil {
				return nil, &InvalidOutputError{"model text is not JSON"}
			}
			return &n, nil
		}
		lastErr = err
		if retryAfter < 0 || attempt == c.MaxAttempts {
			break
		}
		// Backoff 1–2s + jitter, or Retry-After when it still fits the deadline.
		wait := time.Second + time.Duration(rand.Int64N(int64(time.Second)))
		if retryAfter > 0 {
			wait = retryAfter
		}
		if dl, ok := ctx.Deadline(); ok && time.Until(dl) < wait {
			break
		}
		select {
		case <-ctx.Done():
			return nil, &UnavailableError{"deadline exceeded"}
		case <-time.After(wait):
		}
	}
	var ioe *InvalidOutputError
	if errors.As(lastErr, &ioe) {
		return nil, lastErr
	}
	return nil, &UnavailableError{lastErr.Error()}
}

// call does one request. retryAfter < 0 means "do not retry".
func (c *Client) call(ctx context.Context, body []byte) (text string, retryAfter time.Duration, err error) {
	url := fmt.Sprintf("%s/%s/interactions", c.BaseURL, c.APIVersion)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", -1, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", c.APIKey)
	resp, err := c.HC.Do(req)
	if err != nil {
		return "", 0, err // network/timeout: transient
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", 0, err
	}
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusTooManyRequests, http.StatusInternalServerError, http.StatusServiceUnavailable:
		ra, _ := strconv.Atoi(resp.Header.Get("Retry-After"))
		return "", time.Duration(ra) * time.Second, fmt.Errorf("HTTP %d", resp.StatusCode)
	default:
		// 400/401/403/404 and others: retrying will not help. Never log the key or body.
		return "", -1, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	var env struct {
		Status string `json:"status"`
		Steps  []struct {
			Type    string `json:"type"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"steps"`
	}
	if err := json.Unmarshal(data, &env); err != nil {
		return "", -1, &InvalidOutputError{"provider envelope is not JSON"}
	}
	if env.Status != "completed" {
		return "", -1, &InvalidOutputError{"interaction status " + env.Status}
	}
	var sb strings.Builder
	for _, s := range env.Steps {
		if s.Type != "model_output" {
			continue
		}
		for _, ct := range s.Content {
			if ct.Type == "text" {
				sb.WriteString(ct.Text)
			}
		}
	}
	if sb.Len() == 0 {
		return "", -1, &InvalidOutputError{"no model_output text"}
	}
	return sb.String(), 0, nil
}

var htmlTag = regexp.MustCompile(`<\s*[a-zA-Z/!]`)

const maxChars = 20000

// Validate checks §13.6: required fields, size, no HTML, and that details
// reference exactly the source findings (no invented, duplicate or missing refs).
func Validate(n *Narrative, refs []string) error {
	bad := func(r string) error { return &InvalidOutputError{r} }
	if strings.TrimSpace(n.Title) == "" || strings.TrimSpace(n.Summary) == "" {
		return bad("title and summary are required")
	}
	texts := []string{n.Title, n.Summary}
	want := map[string]bool{}
	for _, r := range refs {
		want[r] = true
	}
	seen := map[string]bool{}
	for _, d := range n.Details {
		if !want[d.FindingRef] {
			return bad("unknown finding_ref " + d.FindingRef)
		}
		if seen[d.FindingRef] {
			return bad("duplicate finding_ref " + d.FindingRef)
		}
		if strings.TrimSpace(d.Observation) == "" {
			return bad("empty observation for " + d.FindingRef)
		}
		seen[d.FindingRef] = true
		texts = append(texts, d.Observation, d.FollowUp)
	}
	if len(seen) != len(want) {
		return bad("details do not cover every source finding")
	}
	texts = append(texts, n.MissingInformation...)
	total := 0
	for _, t := range texts {
		if htmlTag.MatchString(t) {
			return bad("HTML is not allowed")
		}
		total += utf8.RuneCountInString(t)
	}
	if total > maxChars {
		return bad("output exceeds 20000 characters")
	}
	return nil
}
