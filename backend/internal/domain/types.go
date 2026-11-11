package domain

import "encoding/json"

// Timestamps are UTC RFC3339 strings produced by Go (SRS §11.4).
const TimeFormat = "2006-01-02T15:04:05.000Z07:00"

const (
	StatusActive   = "active"
	StatusArchived = "archived"

	SessionActive      = "active"
	SessionStopped     = "stopped"
	SessionInterrupted = "interrupted"

	SourceBrowserWebcam = "browser_webcam"
	SourceManualEntry   = "manual_entry"

	ModeReal      = "real"
	ModeSimulated = "simulated"
	ModeManual    = "manual"

	ViolationNoHelmet = "NO_HELMET"
	ViolationNoVest   = "NO_VEST"
)

type User struct {
	ID          int64  `json:"id"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
}

type Project struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Location    string `json:"location"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Version     int64  `json:"version"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

type Zone struct {
	ID          int64  `json:"id"`
	ProjectID   int64  `json:"project_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Version     int64  `json:"version"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

// SessionConfig is frozen at start (SRS §2.2) and stored as config_json.
type SessionConfig struct {
	SampleFPS           int      `json:"sample_fps"`
	ConfirmHits         int      `json:"confirm_hits"`
	ConfirmMaxFrames    int      `json:"confirm_max_frames"`
	ConfirmWindowMS     int64    `json:"confirm_window_ms"`
	TrackTimeoutMS      int64    `json:"track_timeout_ms"`
	SupportedViolations []string `json:"supported_violations,omitempty"`
}

type Session struct {
	ID                  int64         `json:"id"`
	SessionKey          string        `json:"-"`
	ProjectID           int64         `json:"project_id"`
	ZoneID              int64         `json:"zone_id"`
	StartedBy           int64         `json:"started_by"`
	Source              string        `json:"source"`
	Status              string        `json:"status"`
	Mode                string        `json:"mode"`
	ModelVersion        *string       `json:"model_version"`
	EngineInstanceID    *string       `json:"-"`
	SupportedViolations []string      `json:"supported_violations"`
	StartedAt           string        `json:"started_at"`
	EndedAt             *string       `json:"ended_at"`
	EndReason           *string       `json:"end_reason"`
	LastFrameAt         *string       `json:"last_frame_at"`
	Config              SessionConfig `json:"config"`
}

// NewFinding is the immutable model output persisted for an automatic finding.
type NewFinding struct {
	SessionID         int64
	TrackID           int
	TrackKey          string
	Violation         string
	Confidence        float64
	PersonBBoxJSON    string
	ViolationBBoxJSON string
	RawDetectionJSON  string
	ModelVersion      string
	FrameSequence     int64
	FrameWidth        int
	FrameHeight       int
	EvidencePath      string
	EvidenceSHA256    string
	CapturedAt        string
	ReceivedAt        string
}

type Page struct {
	Page     int `json:"page"`
	PageSize int `json:"page_size"`
	Total    int `json:"total"`
}

// Finding is the API resource of SRS §9.6. Project/zone/mode come from the session join.
type Finding struct {
	ID                 int64           `json:"id"`
	SessionID          int64           `json:"session_id"`
	ProjectID          int64           `json:"project_id"`
	ZoneID             int64           `json:"zone_id"`
	Source             string          `json:"source"`
	Mode               string          `json:"mode"`
	TrackID            *int64          `json:"track_id"`
	TrackKey           *string         `json:"track_key"`
	DetectedViolation  *string         `json:"detected_violation"`
	ViolationType      string          `json:"violation_type"`
	Confidence         *float64        `json:"confidence"`
	PersonBBox         json.RawMessage `json:"person_bbox"`
	ViolationBBox      json.RawMessage `json:"violation_bbox"`
	RawDetection       json.RawMessage `json:"raw_detection"`
	EvidenceURL        string          `json:"evidence_url"`
	EvidenceSHA256     string          `json:"evidence_sha256"`
	FrameSequence      *int64          `json:"frame_sequence"`
	FrameWidth         int             `json:"frame_width"`
	FrameHeight        int             `json:"frame_height"`
	ModelVersion       *string         `json:"model_version"`
	CapturedAt         string          `json:"captured_at"`
	ReceivedAt         string          `json:"received_at"`
	VerificationStatus string          `json:"verification_status"`
	VerifiedBy         *int64          `json:"verified_by"`
	VerifiedAt         *string         `json:"verified_at"`
	Notes              string          `json:"notes"`
	ActionStatus       string          `json:"action_status"`
	ActionNotes        string          `json:"action_notes"`
	Version            int64           `json:"version"`
	CreatedAt          string          `json:"created_at"`
	UpdatedAt          string          `json:"updated_at"`
}

type FindingFilter struct {
	ProjectID, ZoneID, SessionID int64
	ViolationType                string
	VerificationStatus           string
	ActionStatus                 string
	From, To                     string // UTC, domain.TimeFormat
	SortCapturedAt               bool
	Page, PageSize               int
}

// SnapshotFinding / Snapshot form the canonical report source (SRS §9.7).
// Field order is fixed so json.Marshal output, and thus source_hash, is stable.
type SnapshotFinding struct {
	ID            int64  `json:"id"`
	Version       int64  `json:"version"`
	ViolationType string `json:"violation_type"`
	CapturedAt    string `json:"captured_at"`
	Notes         string `json:"notes"`
	ActionStatus  string `json:"action_status"`
	ActionNotes   string `json:"action_notes"`
}

type NamedRef struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type Snapshot struct {
	SessionID int64             `json:"session_id"`
	Mode      string            `json:"mode"`
	Project   NamedRef          `json:"project"`
	Zone      NamedRef          `json:"zone"`
	Findings  []SnapshotFinding `json:"findings"`
}

type Report struct {
	ID                    int64    `json:"id"`
	SessionID             int64    `json:"session_id"`
	ProjectID             int64    `json:"project_id"`
	CreatedBy             int64    `json:"created_by"`
	Title                 string   `json:"title"`
	Content               string   `json:"content"`
	Status                string   `json:"status"`
	GeneratedBy           string   `json:"generated_by"`
	GeminiModel           *string  `json:"gemini_model"`
	PromptVersion         *string  `json:"prompt_version"`
	GenerationRequestKey  *string  `json:"-"`
	GenerationPayloadHash *string  `json:"-"`
	SnapshotJSON          string   `json:"-"`
	Snapshot              Snapshot `json:"snapshot"`
	SourceFindingIDs      []int64  `json:"source_finding_ids"`
	SourceHash            string   `json:"source_hash"`
	IsStale               bool     `json:"is_stale"`
	ApprovedBy            *int64   `json:"approved_by"`
	ApprovedAt            *string  `json:"approved_at"`
	Version               int64    `json:"version"`
	CreatedAt             string   `json:"created_at"`
	UpdatedAt             string   `json:"updated_at"`
}

type DashboardFilter struct {
	ProjectID, ZoneID int64
	From, To          string
	Mode              string
}

type TrendPoint struct {
	Date           string `json:"date"`
	CountConfirmed int    `json:"count_confirmed"`
}

type ZoneCount struct {
	ZoneID         int64  `json:"zone_id"`
	ZoneName       string `json:"zone_name"`
	CountConfirmed int    `json:"count_confirmed"`
}

type DashboardSummary struct {
	Sessions             int    `json:"sessions"`
	FindingsPending      int    `json:"findings_pending"`
	FindingsConfirmed    int    `json:"findings_confirmed"`
	FindingsRejected     int    `json:"findings_rejected"`
	ConfirmedActionsOpen int    `json:"confirmed_actions_open"`
	CountUnit            string `json:"count_unit"`
	Mode                 string `json:"mode"`
	Timezone             string `json:"timezone"`
}
