package main

import (
	"errors"
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	// The test binary stands in for FFmpeg so source activation can use the
	// real process-start path on Windows and Unix without a media dependency.
	if os.Getenv("TS6_TEST_ENCODER") == "1" && len(os.Args) > 1 && os.Args[1] == "-reconnect" {
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestSourceActivationRequiresAnEmptyPeerInventory(t *testing.T) {
	s := NewSidecar()
	s.source = "previous"
	start := func(guard bool) error {
		return s.StartFFmpeg("https://example.test/new", 640, 480, 15, "500k", 100, false, guard)
	}

	stats := s.GetStats()
	if stats["supportsEmptyPeerGuard"] != true || stats["pendingPeerCount"] != 0 || stats["peerCount"] != 0 {
		t.Fatalf("expected guard capability and empty inventory, got %v", stats)
	}

	// A peer starts gathering after the backend checked /stats. It is already
	// a potential viewer, even though there is no published peer ID to close.
	s.creating["late"] = &createInFlight{done: make(chan struct{})}
	if pending := s.GetStats()["pendingPeerCount"]; pending != 1 {
		t.Fatalf("pendingPeerCount = %v, want 1", pending)
	}
	if err := start(true); !errors.Is(err, errSidecarPeersPresent) || s.source != "previous" {
		t.Fatalf("guarded start with pending viewer: err = %v, source = %q", err, s.source)
	}

	delete(s.creating, "late")
	peer := &Peer{Started: true}
	s.peers["late"] = peer
	if err := start(true); !errors.Is(err, errSidecarPeersPresent) || s.source != "previous" || !peer.Started {
		t.Fatalf("guarded start with published viewer: err = %v, source = %q, started = %t", err, s.source, peer.Started)
	}

	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("FFMPEG_PATH", executable)
	t.Setenv("TS6_TEST_ENCODER", "1")
	t.Cleanup(func() {
		s.ffmpegLock.Lock()
		defer s.ffmpegLock.Unlock()
		s.StopFFmpegLocked()
	})

	if err := start(false); err != nil || s.peers["late"] != peer || peer.Started {
		t.Fatalf("in-session source change did not preserve and reset the viewer: err = %v", err)
	}
	delete(s.peers, "late")
	if err := start(true); err != nil || s.source != "https://example.test/new" {
		t.Fatalf("guarded start on empty encoder: err = %v, source = %q", err, s.source)
	}
}
