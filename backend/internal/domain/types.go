package domain

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
