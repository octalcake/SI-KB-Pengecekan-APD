package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"k3/backend/internal/config"
	"k3/backend/internal/domain"
	"k3/backend/internal/repository/sqlite"
	"k3/backend/internal/storage"
)

const maxNoteChars = 2000

// Findings implements officer review, follow-up, soft delete and manual entry (SRS §5.5).
type Findings struct {
	Store    *sqlite.Store
	Evidence *storage.Evidence
	Cfg      *config.Config
}

// ReviewInput is the PATCH allowlist; model output fields are never accepted.
type ReviewInput struct {
	Version            *int64  `json:"version"`
	VerificationStatus *string `json:"verification_status"`
	ViolationType      *string `json:"violation_type"`
	Notes              *string `json:"notes"`
	ActionStatus       *string `json:"action_status"`
	ActionNotes        *string `json:"action_notes"`
}

func validViolation(v string) bool {
	return v == domain.ViolationNoHelmet || v == domain.ViolationNoVest
}

func errReportLocked() error {
	return domain.Conflict("REPORT_LOCKED", "Temuan sudah menjadi sumber laporan yang disetujui.")
}

func (s *Findings) Review(ctx context.Context, userID, id int64, in ReviewInput) (*domain.Finding, error) {
	if in.Version == nil {
		return nil, domain.Validation(map[string]string{"version": "required"})
	}
	if in.VerificationStatus == nil && in.ViolationType == nil && in.Notes == nil && in.ActionStatus == nil && in.ActionNotes == nil {
		return nil, domain.Validation(map[string]string{"body": "no editable field given"})
	}
	var out *domain.Finding
	err := s.Store.Tx(ctx, func(q sqlite.Q) error {
		f, err := q.Finding(ctx, id)
		if err != nil {
			return err
		}
		if f.Version != *in.Version {
			return domain.VersionConflict()
		}
		if locked, err := q.LockedByApprovedReport(ctx, f.SessionID, id); err != nil || locked {
			return orErr(err, errReportLocked())
		}

		fields := map[string]string{}
		if in.Notes != nil {
			f.Notes = strings.TrimSpace(*in.Notes)
			checkLen(fields, "notes", f.Notes, 0, maxNoteChars)
		}
		if in.ViolationType != nil {
			if !validViolation(*in.ViolationType) {
				fields["violation_type"] = "invalid"
			}
			f.ViolationType = *in.ViolationType
		}
		if v := in.VerificationStatus; v != nil && *v != f.VerificationStatus {
			if *v != "confirmed" && *v != "rejected" {
				fields["verification_status"] = "must be confirmed or rejected"
			}
			// Correcting an earlier decision needs a fresh reason.
			if f.VerificationStatus != "pending" && (in.Notes == nil || f.Notes == "") {
				fields["notes"] = "reason required to correct a decision"
			}
			if f.VerificationStatus == "confirmed" && *v == "rejected" {
				f.ActionStatus, f.ActionNotes = "pending", ""
			}
			now := sqlite.Now()
			f.VerificationStatus, f.VerifiedBy, f.VerifiedAt = *v, &userID, &now
		}
		if f.VerificationStatus == "rejected" && f.Notes == "" {
			fields["notes"] = "required when rejected"
		}
		if in.ActionStatus != nil || in.ActionNotes != nil {
			if f.VerificationStatus != "confirmed" {
				return domain.NewError(http.StatusUnprocessableEntity, "ACTION_REQUIRES_CONFIRMED", "Tindak lanjut hanya untuk temuan yang dikonfirmasi.")
			}
			if in.ActionStatus != nil {
				switch *in.ActionStatus {
				case "pending", "in_progress", "completed":
					f.ActionStatus = *in.ActionStatus
				default:
					fields["action_status"] = "invalid"
				}
			}
			if in.ActionNotes != nil {
				f.ActionNotes = strings.TrimSpace(*in.ActionNotes)
				checkLen(fields, "action_notes", f.ActionNotes, 0, maxNoteChars)
			}
		}
		if f.ActionStatus == "completed" && f.ActionNotes == "" {
			fields["action_notes"] = "required when completed"
		}
		if len(fields) > 0 {
			return domain.Validation(fields)
		}
		if err := q.UpdateFindingReview(ctx, f); err != nil {
			return err
		}
		out, err = q.Finding(ctx, id)
		return err
	})
	return out, err
}

// Delete soft-deletes a pending/rejected finding. The tombstone keeps the
// BR-03 unique key, so the same episode is never captured again.
func (s *Findings) Delete(ctx context.Context, id, version int64) error {
	return s.Store.Tx(ctx, func(q sqlite.Q) error {
		f, err := q.Finding(ctx, id)
		if err != nil {
			return err
		}
		if f.VerificationStatus == "confirmed" {
			return domain.Conflict("FINDING_CONFIRMED", "Temuan terkonfirmasi harus ditolak dulu sebelum dihapus.")
		}
		if locked, err := q.LockedByApprovedReport(ctx, f.SessionID, id); err != nil || locked {
			return orErr(err, errReportLocked())
		}
		return q.SoftDeleteFinding(ctx, id, version)
	})
}

type ManualInput struct {
	SessionID     int64
	ViolationType string
	Notes         string
	JPEG          []byte
}

// CreateManual adds an officer-observed finding to a closed manual-mode session.
func (s *Findings) CreateManual(ctx context.Context, in ManualInput) (*domain.Finding, error) {
	if !s.Cfg.AllowManualFallback {
		return nil, domain.Forbidden("MANUAL_FALLBACK_DISABLED", "Temuan manual tidak diaktifkan.")
	}
	fields := map[string]string{}
	if in.SessionID <= 0 {
		fields["session_id"] = "required"
	}
	if !validViolation(in.ViolationType) {
		fields["violation_type"] = "invalid"
	}
	in.Notes = strings.TrimSpace(in.Notes)
	checkLen(fields, "notes", in.Notes, 0, maxNoteChars)
	if len(fields) > 0 {
		return nil, domain.Validation(fields)
	}
	w, h, err := checkJPEG(in.JPEG, s.Cfg.FrameMaxPixels)
	if err != nil {
		return nil, err
	}
	sess, err := s.Store.Q().Session(ctx, in.SessionID)
	if err != nil {
		return nil, err
	}
	if sess.Mode != domain.ModeManual || sess.Status == domain.SessionActive {
		return nil, domain.NewError(http.StatusUnprocessableEntity, "SESSION_NOT_MANUAL", "Temuan manual hanya untuk sesi mode manual yang sudah ditutup.")
	}

	rel, err := s.Evidence.Save(in.JPEG, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(in.JPEG)
	id, err := s.Store.Q().InsertManualFinding(ctx, &sqlite.ManualFinding{
		SessionID: in.SessionID, ViolationType: in.ViolationType, Notes: in.Notes,
		FrameWidth: w, FrameHeight: h, EvidencePath: rel, EvidenceSHA256: hex.EncodeToString(sum[:]),
	})
	if err != nil {
		s.Evidence.Remove(rel)
		return nil, err
	}
	return s.Store.Q().Finding(ctx, id)
}
