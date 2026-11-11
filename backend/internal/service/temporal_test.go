package service

import (
	"reflect"
	"testing"
	"time"

	"k3/backend/internal/aiclient"
)

var both = map[string]bool{"NO_HELMET": true, "NO_VEST": true}

func person(id int, state string) aiclient.Person {
	c := 0.9
	b := [4]float64{0.3, 0.1, 0.4, 0.3}
	ppe := aiclient.PPE{Type: "NO_HELMET", State: state}
	if state != "unknown" {
		ppe.Confidence, ppe.BBox = &c, &b
	}
	return aiclient.Person{TrackID: id, Confidence: 0.9, BBox: [4]float64{0.2, 0.1, 0.6, 0.9}, PPE: []aiclient.PPE{ppe}}
}

func newEngine() *Temporal { return NewTemporal(2, 3, 2*time.Second, 5*time.Second) }

func at(sec float64) time.Time {
	return time.Unix(1_800_000_000, 0).Add(time.Duration(sec * float64(time.Second)))
}

// TestSRSTimeline replays the table in SRS §6.4 exactly.
func TestSRSTimeline(t *testing.T) {
	e := newEngine()
	steps := []struct {
		t       float64
		persons []aiclient.Person
		keys    []string
		events  []string // track keys confirmed by this frame
	}{
		{0, []aiclient.Person{person(17, "positive")}, []string{"17:1"}, nil},
		{1, []aiclient.Person{person(17, "unknown")}, []string{"17:1"}, nil},
		{2, []aiclient.Person{person(17, "positive")}, []string{"17:1"}, []string{"17:1"}},
		{3, []aiclient.Person{person(17, "positive"), person(21, "positive")}, []string{"17:1", "21:1"}, nil},
		{4, []aiclient.Person{person(21, "positive")}, []string{"21:1"}, []string{"21:1"}},
		{5, nil, []string{}, nil},
		{6, nil, []string{}, nil},
		{7, nil, []string{}, nil},
		{8, nil, []string{}, nil}, // 17:1 expires here (last seen t=3)
		{9, nil, []string{}, nil},
		{10, []aiclient.Person{person(17, "positive")}, []string{"17:2"}, nil},
		{11, []aiclient.Person{person(17, "positive")}, []string{"17:2"}, []string{"17:2"}},
	}
	for _, s := range steps {
		keys, events := e.Observe(at(s.t), s.persons, both)
		if !reflect.DeepEqual(keys, s.keys) {
			t.Fatalf("t=%v keys=%v want %v", s.t, keys, s.keys)
		}
		var got []string
		for _, ev := range events {
			got = append(got, ev.TrackKey)
			e.MarkRecorded(ev.TrackKey, ev.Violation)
		}
		if !reflect.DeepEqual(got, s.events) {
			t.Fatalf("t=%v events=%v want %v", s.t, got, s.events)
		}
		if s.t == 8 {
			if _, alive := e.tracks[17]; alive {
				t.Fatal("17:1 should be expired at t=8")
			}
		}
	}
}

func TestOutsideWindowDoesNotConfirm(t *testing.T) {
	e := newEngine()
	e.Observe(at(0), []aiclient.Person{person(1, "positive")}, both)
	if _, ev := e.Observe(at(2.1), []aiclient.Person{person(1, "positive")}, both); len(ev) != 0 {
		t.Fatal("positives 2.1s apart must not confirm")
	}
}

func TestLatestFrameMustBePositive(t *testing.T) {
	e := newEngine()
	e.Observe(at(0), []aiclient.Person{person(1, "positive")}, both)
	if _, ev := e.Observe(at(1), []aiclient.Person{person(1, "unknown")}, both); len(ev) != 0 {
		t.Fatal("[+, unknown] must not confirm")
	}
}

func TestUnsupportedViolationIgnored(t *testing.T) {
	e := newEngine()
	helmetOff := map[string]bool{"NO_VEST": true}
	e.Observe(at(0), []aiclient.Person{person(1, "positive")}, helmetOff)
	if _, ev := e.Observe(at(1), []aiclient.Person{person(1, "positive")}, helmetOff); len(ev) != 0 {
		t.Fatal("unsupported violation must not confirm")
	}
}
