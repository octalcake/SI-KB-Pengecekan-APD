package service

import (
	"fmt"
	"time"

	"k3/backend/internal/aiclient"
)

// Temporal is the in-memory 2-of-3 confirmation engine (SRS §6.3). It does no
// I/O; callers pass the Go receipt time of each valid frame. Not goroutine-safe:
// the monitoring session lock serialises access.
type Temporal struct {
	hits      int
	maxFrames int
	window    time.Duration
	timeout   time.Duration

	frames   []tframe         // recent valid frames, oldest first
	tracks   map[int]*episode // live episode per raw tracker ID
	episodes map[int]int      // last episode number per raw ID in this session
}

type tframe struct {
	at        time.Time
	positives map[string]bool // trackKey|violation
}

type episode struct {
	key      string
	lastSeen time.Time
	recorded map[string]bool
}

// Event is a newly confirmed temporal event; it becomes a pending finding.
type Event struct {
	TrackID   int
	TrackKey  string
	Violation string
	Person    aiclient.Person
	PPE       aiclient.PPE
}

func NewTemporal(hits, maxFrames int, window, timeout time.Duration) *Temporal {
	return &Temporal{hits: hits, maxFrames: maxFrames, window: window, timeout: timeout,
		tracks: map[int]*episode{}, episodes: map[int]int{}}
}

// Expire ends episodes whose Person has not been observed for >= timeout.
func (t *Temporal) Expire(now time.Time) {
	for id, ep := range t.tracks {
		if now.Sub(ep.lastSeen) >= t.timeout {
			delete(t.tracks, id)
		}
	}
}

// Observe records one valid frame. It returns the track key for each person
// (same order as persons) and the events confirmed by this frame. Only
// violations in supported count as positive.
func (t *Temporal) Observe(now time.Time, persons []aiclient.Person, supported map[string]bool) ([]string, []Event) {
	t.Expire(now)

	type cand struct {
		ep     *episode
		person aiclient.Person
		ppe    aiclient.PPE
	}
	cur := tframe{at: now, positives: map[string]bool{}}
	keys := make([]string, len(persons))
	var cands []cand
	for i, p := range persons {
		ep := t.tracks[p.TrackID]
		if ep == nil {
			t.episodes[p.TrackID]++
			ep = &episode{key: fmt.Sprintf("%d:%d", p.TrackID, t.episodes[p.TrackID]), recorded: map[string]bool{}}
			t.tracks[p.TrackID] = ep
		}
		ep.lastSeen = now
		keys[i] = ep.key
		for _, o := range p.PPE {
			if o.State == "positive" && supported[o.Type] && !cur.positives[ep.key+"|"+o.Type] {
				cur.positives[ep.key+"|"+o.Type] = true
				cands = append(cands, cand{ep, p, o})
			}
		}
	}

	// Keep frames whose receipt is within [now-window, now] (inclusive), then the last maxFrames.
	t.frames = append(t.frames, cur)
	start := 0
	for start < len(t.frames) && now.Sub(t.frames[start].at) > t.window {
		start++
	}
	t.frames = t.frames[start:]
	win := t.frames
	if len(win) > t.maxFrames {
		win = win[len(win)-t.maxFrames:]
	}

	var events []Event
	for _, c := range cands {
		if c.ep.recorded[c.ppe.Type] {
			continue
		}
		n := 0
		for _, f := range win {
			if f.positives[c.ep.key+"|"+c.ppe.Type] {
				n++
			}
		}
		if n >= t.hits {
			events = append(events, Event{TrackID: c.person.TrackID, TrackKey: c.ep.key, Violation: c.ppe.Type, Person: c.person, PPE: c.ppe})
		}
	}
	return keys, events
}

// MarkRecorded suppresses further events for this key+violation until the
// episode expires. Call only after evidence file and DB insert succeeded.
func (t *Temporal) MarkRecorded(trackKey, violation string) {
	for _, ep := range t.tracks {
		if ep.key == trackKey {
			ep.recorded[violation] = true
		}
	}
}
