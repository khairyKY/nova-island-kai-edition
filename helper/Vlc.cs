// VLC 3 doesn't publish a Windows media session, so the island reads it directly:
//   title    the main window's title ("<now playing> - VLC media player")
//   playing  VLC's own audio session is active (VLC stops its audio stream on pause)
//   controls WM_APPCOMMAND play/pause, next, previous to the main window (VLC handles these
//            for multimedia keyboards)
// No position, duration or artwork: VLC 3 doesn't expose them without its web interface.
using System;
using System.Runtime.InteropServices;
using System.Text;

[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2 {
  int f(); int g();
  int GetSessionEnumerator(out IAudioSessionEnumerator e);
}
[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator {
  int GetCount(out int n);
  int GetSession(int i, [MarshalAs(UnmanagedType.IUnknown)] out object s);
}
[ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2 {
  int GetState(out int state);
  int a(); int b(); int c(); int d(); int e(); int f(); int g(); int h();
  int i(); int j();
  int GetProcessId(out uint pid);
}
[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioMeterInformation {
  int GetPeakValue(out float peak);
}

static class Vlc {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);

  const string SUFFIX = " - VLC media player";
  const uint WM_APPCOMMAND = 0x0319;

  public static IntPtr Window;   // VLC's main window while it has something open
  public static string Title = "";
  static uint pid;
  static DateTime heardAt = DateTime.MinValue;

  // Fills Window/Title; false when VLC isn't running or has nothing open.
  public static bool Find() {
    IntPtr found = IntPtr.Zero;
    string title = "";
    var sb = new StringBuilder(512);
    // hidden windows count too: VLC minimized to the tray hides its main window
    EnumWindows((h, l) => {
      sb.Length = 0;
      if (GetWindowText(h, sb, sb.Capacity) <= SUFFIX.Length) return true;
      string t = sb.ToString();
      if (!t.EndsWith(SUFFIX, StringComparison.Ordinal)) return true;
      uint p;
      GetWindowThreadProcessId(h, out p);
      if (p != pid) {
        try {
          using (var proc = System.Diagnostics.Process.GetProcessById((int)p))
            if (!string.Equals(proc.ProcessName, "vlc", StringComparison.OrdinalIgnoreCase)) return true;
        } catch { return true; }
        pid = p;
      }
      found = h;
      title = t.Substring(0, t.Length - SUFFIX.Length).Trim();
      return false;
    }, IntPtr.Zero);
    Window = found;
    Title = title;
    return found != IntPtr.Zero && title != "";
  }

  // Playing = VLC's audio session is active (pause stops the stream) and made a sound in the
  // last 60 s (a stopped player can leave the session open; a lecture's pauses stay "playing").
  public static bool Playing() {
    bool active;
    float peak = Peak(p => p == pid, out active);
    // (an open stream on the first look counts as heard, so it doesn't start as "paused")
    if (active && (peak > 0.0005f || heardAt == DateTime.MinValue)) heardAt = DateTime.UtcNow;
    return active && (DateTime.UtcNow - heardAt).TotalSeconds < 60;
  }

  // Can it be heard? A process's audio sessions made a sound in the last 3 s (a muted app's
  // meter reads zero). For telling a player you hear from one playing on mute.
  static readonly System.Collections.Generic.Dictionary<string, DateTime> heard = new System.Collections.Generic.Dictionary<string, DateTime>();
  public static bool Audible(string processName) {
    var pids = new System.Collections.Generic.HashSet<uint>();
    foreach (var proc in System.Diagnostics.Process.GetProcessesByName(processName)) { pids.Add((uint)proc.Id); proc.Dispose(); }
    if (pids.Count == 0) return false;
    bool active;
    float peak = Peak(p => pids.Contains(p), out active);
    if (active && peak > 0.0005f) heard[processName] = DateTime.UtcNow;
    DateTime at;
    return heard.TryGetValue(processName, out at) && (DateTime.UtcNow - at).TotalSeconds < 3;
  }

  // the loudest peak among the default output's audio sessions of the matching processes
  static float Peak(Func<uint, bool> match, out bool active) {
    active = false;
    float peak = 0;
    try {
      var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      IMMDevice dev;
      Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
      Guid iid = typeof(IAudioSessionManager2).GUID;
      object o;
      Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, 0, out o));
      IAudioSessionEnumerator list;
      Marshal.ThrowExceptionForHR(((IAudioSessionManager2)o).GetSessionEnumerator(out list));
      int n;
      list.GetCount(out n);
      for (int i = 0; i < n; i++) {
        object s;
        if (list.GetSession(i, out s) != 0 || s == null) continue;
        var c = s as IAudioSessionControl2;
        uint p;
        if (c == null || c.GetProcessId(out p) != 0 || !match(p)) continue;
        int state;
        if (c.GetState(out state) == 0 && state == 1) active = true;
        var meter = s as IAudioMeterInformation;
        float v;
        if (meter != null && meter.GetPeakValue(out v) == 0 && v > peak) peak = v;
      }
    } catch { }
    return peak;
  }

  // toggle | next | prev
  public static void Command(string cmd) {
    int app = cmd == "toggle" ? 14 : cmd == "next" ? 11 : cmd == "prev" ? 12 : 0;
    if (app == 0 || Window == IntPtr.Zero) return;
    PostMessage(Window, WM_APPCOMMAND, Window, (IntPtr)(app << 16));
  }
}
