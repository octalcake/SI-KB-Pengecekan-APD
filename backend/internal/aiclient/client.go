// Package aiclient talks to the FastAPI service (SRS §10). Only Go calls it.
package aiclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"strconv"
)

const (
	maxResponseBytes = 256 << 10
	maxPersons       = 50
)

type ModelInfo struct {
	Ready               bool     `json:"ready"`
	ModelVersion        string   `json:"model_version"`
	Mode                string   `json:"mode"`
	SupportedViolations []string `json:"supported_violations"`
	EngineInstanceID    string   `json:"engine_instance_id"`
}

type InferRequest struct {
	SessionKey      string
	FrameSequence   int64
	CapturedAt      string
	SampleElapsedMS int64
	SHA256          string
	JPEG            []byte
}

type PPE struct {
	Type       string      `json:"type"`
	State      string      `json:"state"`
	Confidence *float64    `json:"confidence"`
	BBox       *[4]float64 `json:"bbox"`
}

type Person struct {
	TrackID    int        `json:"track_id"`
	Confidence float64    `json:"confidence"`
	BBox       [4]float64 `json:"bbox"`
	PPE        []PPE      `json:"ppe"`
}

type InferResult struct {
	SessionKey       string   `json:"session_key"`
	EngineInstanceID string   `json:"engine_instance_id"`
	FrameSequence    int64    `json:"frame_sequence"`
	Mode             string   `json:"mode"`
	ModelVersion     string   `json:"model_version"`
	Width            int      `json:"width"`
	Height           int      `json:"height"`
	InferenceMS      int64    `json:"inference_ms"`
	Persons          []Person `json:"persons"`
}

// Client is the boundary swapped by a fake in tests.
type Client interface {
	ModelInfo(ctx context.Context) (*ModelInfo, error)
	StartSession(ctx context.Context, sessionKey, mode string) error
	StopSession(ctx context.Context, sessionKey string) error
	Infer(ctx context.Context, req InferRequest) (*InferResult, error)
}

// StatusError is a non-2xx answer from the AI service.
type StatusError struct {
	Status int
	Body   string
}

func (e *StatusError) Error() string { return fmt.Sprintf("ai service HTTP %d: %s", e.Status, e.Body) }

type HTTP struct {
	BaseURL string
	Token   string
	HC      *http.Client
}

func New(baseURL, token string) *HTTP {
	return &HTTP{BaseURL: baseURL, Token: token, HC: &http.Client{}}
}

func (c *HTTP) ModelInfo(ctx context.Context) (*ModelInfo, error) {
	var mi ModelInfo
	if err := c.do(ctx, http.MethodGet, "/internal/v1/model-info", nil, "", &mi); err != nil {
		return nil, err
	}
	var h struct {
		EngineInstanceID string `json:"engine_instance_id"`
	}
	if err := c.do(ctx, http.MethodGet, "/internal/health", nil, "", &h); err != nil {
		return nil, err
	}
	mi.EngineInstanceID = h.EngineInstanceID
	return &mi, nil
}

func (c *HTTP) StartSession(ctx context.Context, sessionKey, mode string) error {
	body, _ := json.Marshal(map[string]string{"session_key": sessionKey, "mode": mode})
	return c.do(ctx, http.MethodPost, "/internal/v1/sessions/start", bytes.NewReader(body), "application/json", nil)
}

func (c *HTTP) StopSession(ctx context.Context, sessionKey string) error {
	body, _ := json.Marshal(map[string]string{"session_key": sessionKey})
	return c.do(ctx, http.MethodPost, "/internal/v1/sessions/stop", bytes.NewReader(body), "application/json", nil)
}

func (c *HTTP) Infer(ctx context.Context, r InferRequest) (*InferResult, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	mw.WriteField("session_key", r.SessionKey)
	mw.WriteField("frame_sequence", strconv.FormatInt(r.FrameSequence, 10))
	mw.WriteField("captured_at", r.CapturedAt)
	mw.WriteField("sample_elapsed_ms", strconv.FormatInt(r.SampleElapsedMS, 10))
	mw.WriteField("sha256", r.SHA256)
	fw, _ := mw.CreateFormFile("frame", "frame.jpg")
	fw.Write(r.JPEG)
	mw.Close()

	var res InferResult
	if err := c.do(ctx, http.MethodPost, "/internal/v1/infer", &buf, mw.FormDataContentType(), &res); err != nil {
		return nil, err
	}
	if err := Validate(&res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *HTTP) do(ctx context.Context, method, path string, body io.Reader, ctype string, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("X-Internal-Token", c.Token)
	if ctype != "" {
		req.Header.Set("Content-Type", ctype)
	}
	resp, err := c.HC.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return err
	}
	if len(data) > maxResponseBytes {
		return ErrInvalidOutput("response exceeds 256KiB")
	}
	if resp.StatusCode/100 != 2 {
		return &StatusError{Status: resp.StatusCode, Body: string(data[:min(len(data), 200)])}
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(data, out); err != nil {
		return ErrInvalidOutput("invalid JSON: " + err.Error())
	}
	return nil
}

// InvalidOutputError marks a response that breaks the §10 contract (→ 502).
type InvalidOutputError struct{ Reason string }

func (e *InvalidOutputError) Error() string { return "invalid AI output: " + e.Reason }

func ErrInvalidOutput(reason string) error { return &InvalidOutputError{reason} }

func IsInvalidOutput(err error) bool {
	var e *InvalidOutputError
	return errors.As(err, &e)
}

// Validate enforces §10 output limits: bbox order/range, enums, finite confidence, person cap.
func Validate(r *InferResult) error {
	if len(r.Persons) > maxPersons {
		return ErrInvalidOutput("more than 50 persons")
	}
	if r.Width <= 0 || r.Height <= 0 {
		return ErrInvalidOutput("invalid frame size")
	}
	for _, p := range r.Persons {
		if !validConf(p.Confidence) || !validBBox(p.BBox) {
			return ErrInvalidOutput("invalid person box")
		}
		for _, o := range p.PPE {
			if o.Type != "NO_HELMET" && o.Type != "NO_VEST" {
				return ErrInvalidOutput("unknown ppe type " + o.Type)
			}
			switch o.State {
			case "positive", "negative":
				if o.Confidence == nil || !validConf(*o.Confidence) || o.BBox == nil || !validBBox(*o.BBox) {
					return ErrInvalidOutput("ppe needs confidence and bbox")
				}
			case "unknown":
				if o.Confidence != nil && !validConf(*o.Confidence) {
					return ErrInvalidOutput("invalid ppe confidence")
				}
			default:
				return ErrInvalidOutput("unknown ppe state " + o.State)
			}
		}
	}
	return nil
}

func validConf(c float64) bool { return !math.IsNaN(c) && c >= 0 && c <= 1 }

func validBBox(b [4]float64) bool {
	for _, v := range b {
		if math.IsNaN(v) || v < 0 || v > 1 {
			return false
		}
	}
	return b[0] < b[2] && b[1] < b[3]
}

// IsTimeout reports a deadline hit, used for the single same-sequence retry.
func IsTimeout(err error) bool {
	var ne interface{ Timeout() bool }
	return errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &ne) && ne.Timeout())
}
