// Nova Island system bridge, compiled (replaces media.ps1, same protocol).
// Prints media changes immediately via SMTC events, with a 500 ms system-state fallback:
// media session (or VLC: Vlc.cs), volume, brightness, fullscreen,
// window in front, keyboard layout, Caps Lock.
// Reads commands on stdin: toggle | next | prev | seek <sec> | vol <0-1> | mute | bright <0-100>
//   | pauseapp <appId> | playapp <appId> | seekapp <appId> <sec>
//   | focusapp	<id>	<exe>            -> {"focusapp":id,"result":"focused"|"none"}
//   | runningapps	<id>	<exe>	...    -> {"running":[ids]}
// Build: helper/build.cmd (uses the C# compiler that ships with Windows).
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Win32;
using Windows.Media.Control;
using Windows.Storage.Streams;

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid id, int clsCtx, int activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object aev);
  [PreserveSig] int OpenPropertyStore(int access, out IntPtr store);
  [PreserveSig] int GetId(out IntPtr id);
}
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int f();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject { }

static class Audio {
  public static T Endpoint<T>() where T : class {
    var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice dev = null;
    try {
      Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
      Guid iid = typeof(T).GUID;
      object o;
      Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, 0, out o));
      return (T)o;
    } finally {
      if (dev != null) Marshal.ReleaseComObject(dev);
      Marshal.ReleaseComObject(en);
    }
  }
  static IAudioEndpointVolume Vol() { return Endpoint<IAudioEndpointVolume>(); }
  public static string OutputId() {
    var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice dev = null;
    IntPtr id = IntPtr.Zero;
    try {
      Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
      Marshal.ThrowExceptionForHR(dev.GetId(out id));
      return Marshal.PtrToStringUni(id);
    } finally {
      if (id != IntPtr.Zero) Marshal.FreeCoTaskMem(id);
      if (dev != null) Marshal.ReleaseComObject(dev);
      Marshal.ReleaseComObject(en);
    }
  }
  public static void Read(out float volume, out bool muted) {
    var endpoint = Vol();
    try {
      Marshal.ThrowExceptionForHR(endpoint.GetMasterVolumeLevelScalar(out volume));
      Marshal.ThrowExceptionForHR(endpoint.GetMute(out muted));
    } finally { Marshal.ReleaseComObject(endpoint); }
  }
  public static void SetVolume(float volume) {
    var endpoint = Vol();
    try {
      Marshal.ThrowExceptionForHR(endpoint.SetMasterVolumeLevelScalar(volume, Guid.Empty));
      if (volume > 0) Marshal.ThrowExceptionForHR(endpoint.SetMute(false, Guid.Empty));
    } finally { Marshal.ReleaseComObject(endpoint); }
  }
  public static void ToggleMute() {
    var endpoint = Vol();
    try {
      bool muted;
      Marshal.ThrowExceptionForHR(endpoint.GetMute(out muted));
      Marshal.ThrowExceptionForHR(endpoint.SetMute(!muted, Guid.Empty));
    } finally { Marshal.ReleaseComObject(endpoint); }
  }
}

static class Win {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct GUITHREADINFO {
    public int Size, Flags;
    public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
    public RECT CaretRect;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT pt);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, int flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);
  [DllImport("user32.dll")] static extern short GetKeyState(int vk);
  [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterClipboardFormat(string name);
  [DllImport("user32.dll")] static extern bool IsClipboardFormatAvailable(uint format);
  [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr owner);
  [DllImport("user32.dll")] static extern bool CloseClipboard();
  [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr h);
  [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr h);

  // Password managers mark what they copy so history tools skip it: either format present
  // ("Exclude...") or CanIncludeInClipboardHistory set to 0. Checked once per clipboard change.
  static long privSeq = -1;
  static bool privValue;
  public static bool ClipboardPrivate(long seq) {
    if (seq == privSeq) return privValue;
    privSeq = seq;
    privValue = false;
    if (IsClipboardFormatAvailable(RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing"))) return privValue = true;
    uint can = RegisterClipboardFormat("CanIncludeInClipboardHistory");
    if (!IsClipboardFormatAvailable(can)) return privValue;
    if (!OpenClipboard(IntPtr.Zero)) return privValue = true; // can't look: treat as private
    try {
      IntPtr h = GetClipboardData(can);
      if (h == IntPtr.Zero) return privValue = true;
      IntPtr p = GlobalLock(h);
      try { return privValue = p == IntPtr.Zero || Marshal.ReadInt32(p) == 0; } finally { GlobalUnlock(h); }
    } finally { CloseClipboard(); }
  }
  [StructLayout(LayoutKind.Sequential)] struct SYSTEM_POWER_STATUS {
    public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag;
    public int BatteryLifeTime, BatteryFullLifeTime;
  }
  [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS s);

  // battery percent (-1: no battery, e.g. a desktop PC) and whether the charger is plugged in
  public static void Battery(out int pct, out bool ac) {
    SYSTEM_POWER_STATUS s;
    pct = -1; ac = true;
    if (!GetSystemPowerStatus(out s)) return;
    ac = s.ACLineStatus != 0;
    if ((s.BatteryFlag & 128) == 0 && s.BatteryLifePercent <= 100) pct = s.BatteryLifePercent;
  }

  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO lii);

  // seconds since the last keyboard / mouse input anywhere
  public static int IdleSeconds() {
    var lii = new LASTINPUTINFO();
    lii.cbSize = (uint)Marshal.SizeOf(lii);
    if (!GetLastInputInfo(ref lii)) return 0;
    return (int)(((uint)Environment.TickCount - lii.dwTime) / 1000);
  }

  public static long ClipboardSeq() { return GetClipboardSequenceNumber(); }

  public static int KeyboardLayout() {
    IntPtr h = GetForegroundWindow();
    uint pid;
    uint thread = h == IntPtr.Zero ? 0 : GetWindowThreadProcessId(h, out pid);
    return (int)((long)GetKeyboardLayout(thread) & 0xFFFF);
  }

  public static bool CapsLock() { return (GetKeyState(0x14) & 1) != 0; }

  public static IntPtr ForegroundHandle() { return GetForegroundWindow(); }
  public static bool AltHeld() { return (GetAsyncKeyState(0x12) & 0x8000) != 0; }
  // cheap change detector for the window-state loop
  public static string RectKey(IntPtr h) {
    RECT r;
    return GetWindowRect(h, out r) ? r.L + "," + r.T + "," + r.R + "," + r.B : "";
  }

  public static bool VisibleBounds(IntPtr h, out RECT r) {
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0 && !GetWindowRect(h, out r)) return false;
    var monitor = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref monitor)) return true;
    var work = monitor.rcWork;
    // Opera GX can draw its own maximized frame without setting WS_MAXIMIZE.
    bool fillsWorkArea = r.L <= work.L && r.T <= work.T && r.R >= work.R && r.B >= work.B;
    if (IsZoomed(h) || fillsWorkArea) {
      r.L = Math.Max(r.L, monitor.rcMonitor.L);
      r.T = Math.Max(r.T, monitor.rcMonitor.T);
      r.R = Math.Min(r.R, monitor.rcMonitor.R);
      r.B = Math.Min(r.B, monitor.rcMonitor.B);
    }
    return true;
  }

  public static double DpiScale(IntPtr h) {
    try { uint dpi = GetDpiForWindow(h); if (dpi != 0) return dpi / 96.0; } catch (EntryPointNotFoundException) { }
    return 1;
  }

  public static bool ClientBounds(IntPtr h, out RECT r) {
    if (!GetClientRect(h, out r)) return false;
    var topLeft = new POINT { X = r.L, Y = r.T };
    var bottomRight = new POINT { X = r.R, Y = r.B };
    if (!ClientToScreen(h, ref topLeft) || !ClientToScreen(h, ref bottomRight)) return false;
    r = new RECT { L = topLeft.X, T = topLeft.Y, R = bottomRight.X, B = bottomRight.Y };
    return r.R > r.L && r.B > r.T;
  }

  public static int MaximizedTopInset(IntPtr h) {
    RECT window, client;
    if (!IsZoomed(h) || !GetWindowRect(h, out window) || !ClientBounds(h, out client)) return 0;
    return Math.Max(0, client.T - window.T);
  }

  public static bool CaretIn(IntPtr h, System.Windows.Rect rect) {
    uint pid;
    uint thread = GetWindowThreadProcessId(h, out pid);
    var info = new GUITHREADINFO { Size = Marshal.SizeOf(typeof(GUITHREADINFO)) };
    if (thread == 0 || !GetGUIThreadInfo(thread, ref info) || info.Caret == IntPtr.Zero) return false;
    var point = new POINT { X = info.CaretRect.L, Y = info.CaretRect.T };
    return ClientToScreen(info.Caret, ref point) && rect.Contains(point.X, point.Y);
  }

  // Recording pauses our backdrop sampling to save capture work. The island itself
  // remains visible to recorders and screenshot tools in every theme.
  static readonly string[] Recorders = { "nvsphelper64", "nvsphelper", "obs64", "obs32", "obs", "Streamlabs OBS", "Streamlabs Desktop" };
  public static bool RecorderRunning() {
    foreach (var name in Recorders) {
      var ps = System.Diagnostics.Process.GetProcessesByName(name);
      bool any = ps.Length > 0;
      foreach (var p in ps) p.Dispose();
      if (any) return true;
    }
    return false;
  }

  // the browser window in front (any browser), for "Stay in place": the island goes see-through
  // over it. JSON in physical pixels, or "null".
  static readonly string[] Browsers = { "chrome", "msedge", "brave", "opera", "vivaldi", "firefox" };
  public static string BrowserJson(IntPtr h, string proc, bool fullscreen) {
    RECT r;
    if (fullscreen || h == IntPtr.Zero || Array.IndexOf(Browsers, (proc ?? "").ToLowerInvariant()) < 0 || !VisibleBounds(h, out r)) return "null";
    return "{\"x\":" + r.L + ",\"y\":" + r.T + ",\"w\":" + (r.R - r.L) + ",\"h\":" + (r.B - r.T) + "}";
  }
  public static string ClassOf(IntPtr h) {
    var sb = new StringBuilder(64);
    GetClassName(h, sb, 64);
    return sb.ToString();
  }
  // physical pixels everywhere (UI Automation rectangles, window rects); main converts to DIPs
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  public static void PerMonitorDpi() { try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { } }

  public static void Foreground(IntPtr h, out string proc, out string title) {
    proc = ""; title = "";
    if (h == IntPtr.Zero) return;
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    try { using (var p = System.Diagnostics.Process.GetProcessById((int)pid)) proc = p.ProcessName; } catch { }
    var sb = new StringBuilder(512);
    GetWindowText(h, sb, 512);
    title = sb.ToString();
  }

  public static bool IsFullscreen(IntPtr h) {
    if (h == IntPtr.Zero) return false;
    var sb = new StringBuilder(64);
    GetClassName(h, sb, 64);
    string cls = sb.ToString();
    if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd") return false;
    RECT r;
    if (!GetWindowRect(h, out r)) return false;
    var mi = new MONITORINFO();
    mi.cbSize = Marshal.SizeOf(mi);
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return false;
    var m = mi.rcMonitor;
    return r.L == m.L && r.T == m.T && r.R == m.R && r.B == m.B;
  }
}

static class WindowState {
  const uint SwitchStart = 0x0014, SwitchEnd = 0x0015;
  static readonly string[] LauncherProcesses = { "StartMenuExperienceHost", "SearchHost", "SearchApp", "SearchUI" };
  delegate void WinEvent(IntPtr hook, uint ev, IntPtr hwnd, int obj, int child, uint thread, uint time);
  [StructLayout(LayoutKind.Sequential)] struct MSG {
    public IntPtr Hwnd;
    public uint Message;
    public UIntPtr WParam;
    public IntPtr LParam;
    public uint Time;
    public int X, Y;
  }
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint first, uint last, IntPtr module, WinEvent callback, uint pid, uint tid, uint flags);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint first, uint last);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  const uint ObjectFocus = 0x8005, SkipOwnProcess = 2, GaRoot = 2;
  static volatile bool switching;
  static volatile bool focusMoved; // keyboard focus moved inside the foreground window: re-read the address bar now
  static readonly AutoResetEvent wake = new AutoResetEvent(false);
  const int FastMs = 100, SlowMs = 250, BurstMs = 1500, OmniMs = 1000;

  public static void Start(TextWriter output) {
    new Thread(() => {
      WinEvent callback = (hook, ev, hwnd, obj, child, thread, time) => { switching = ev == SwitchStart; wake.Set(); };
      WinEvent focus = (hook, ev, hwnd, obj, child, thread, time) => {
        if (hwnd != IntPtr.Zero && GetAncestor(hwnd, GaRoot) == Win.ForegroundHandle()) { focusMoved = true; wake.Set(); }
      };
      if (SetWinEventHook(SwitchStart, SwitchEnd, IntPtr.Zero, callback, 0, 0, 0) == IntPtr.Zero) return;
      SetWinEventHook(ObjectFocus, ObjectFocus, IntPtr.Zero, focus, 0, 0, SkipOwnProcess); // out-of-context
      MSG msg;
      while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
      GC.KeepAlive(callback);
      GC.KeepAlive(focus);
    }) { IsBackground = true }.Start();
    new Thread(() => Watch(output)) { IsBackground = true }.Start();
  }

  static void Watch(TextWriter output) {
    string last = null, proc = "", title = "", lastRect = null, omni = "null", omniKey = null;
    IntPtr lastForeground = IntPtr.Zero;
    // Fast ticks only for a short burst after the window moves/changes or the switcher shows;
    // the cross-process UI Automation read only when the window changed, else once a second.
    var fastUntil = DateTime.MinValue;
    var nextOmni = DateTime.MinValue;
    while (true) {
      try {
        var fg = Win.ForegroundHandle();
        if (!Win.AltHeld()) switching = false;
        var now = DateTime.UtcNow;
        // A missing foreground HWND during activation is not itself a task switch.
        if (fg == IntPtr.Zero && !switching) {
          fastUntil = now.AddMilliseconds(BurstMs);
          wake.WaitOne(FastMs);
          continue;
        }
        string rect = Win.RectKey(fg);
        bool focusEvent = focusMoved;
        focusMoved = false;
        if (fg != lastForeground || rect != lastRect || focusEvent) fastUntil = now.AddMilliseconds(BurstMs);
        lastRect = rect;
        if (fg != lastForeground) {
          Win.Foreground(fg, out proc, out title);
          lastForeground = fg;
        }
        var cls = Win.ClassOf(fg);
        bool shellSwitcher = cls == "#32771" || cls == "MultitaskingViewFrame" || cls == "TaskSwitcherWnd" ||
          (cls == "XamlExplorerHostIslandWindow" && (switching || title == "Task Switching"));
        bool suspended = switching || shellSwitcher;
        bool capture = string.Equals(proc, "ScreenClippingHost", StringComparison.OrdinalIgnoreCase) ||
          (string.Equals(proc, "SnippingTool", StringComparison.OrdinalIgnoreCase) && Win.IsFullscreen(fg));
        bool launcher = !suspended && (capture || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd" ||
          Array.Exists(LauncherProcesses, name => string.Equals(name, proc, StringComparison.OrdinalIgnoreCase)));
        bool fullscreen = !suspended && !launcher && Win.IsFullscreen(fg);
        bool hidden = fullscreen || suspended || launcher;
        // switcher/launcher up keeps the fast cadence, and for a burst after it closes
        if (suspended || launcher) fastUntil = now.AddMilliseconds(BurstMs);
        string key = fg.ToInt64() + "|" + rect + "|" + hidden;
        if (key != omniKey || focusEvent || now >= nextOmni) {
          omni = AddressBar.Json(fg, proc, hidden);
          omniKey = key;
          nextOmni = DateTime.UtcNow.AddMilliseconds(OmniMs);
        }
        var browser = Win.BrowserJson(fg, proc, hidden);
        if (fg != Win.ForegroundHandle()) continue; // UI Automation may have taken a while.
        var line = new Json().Add("windowState", true).Add("suspended", suspended)
          .Add("foreground", fg.ToInt64().ToString()).Add("fs", fullscreen).Add("launcher", launcher).Add("capture", capture)
          .Raw("omni", omni).Raw("browser", browser).ToString();
        if (line != last) { output.WriteLine(line); last = line; }
      } catch (IOException) { return; } catch { }
      wake.WaitOne(DateTime.UtcNow < fastUntil ? FastMs : SlowMs);
    }
  }
}

// Glass backdrop: four 1-px strips just outside the overlay, read with small GDI blits instead of
// a full-screen grab. Physical virtual-desktop pixels in, base64 BGRA samples out.
static class Strips {
  [StructLayout(LayoutKind.Sequential)] struct BITMAPINFOHEADER {
    public int Size, Width, Height;
    public short Planes, BitCount;
    public int Compression, SizeImage, XPels, YPels, ClrUsed, ClrImportant;
  }
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc, ref BITMAPINFOHEADER bmi, uint usage, out IntPtr bits, IntPtr section, uint offset);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
  [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
  [DllImport("gdi32.dll")] static extern bool GdiFlush();
  const uint SrcCopy = 0x00CC0020; // no CAPTUREBLT: layered windows (the island itself) stay out

  public static string Line(int id, int x, int y, int w, int h) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
    int cols = Math.Min(h, 64), rows = Math.Min(w, 32);
    bool leftIn = x - 4 >= vx && x - 4 < vx + vw, rightIn = x + w + 3 >= vx && x + w + 3 < vx + vw;
    bool topIn = y - 4 >= vy && y - 4 < vy + vh, bottomIn = y + h + 3 >= vy && y + h + 3 < vy + vh;
    // One blit of the ring around the overlay: every screen BitBlt waits on the compositor
    // (~8 ms each, almost independent of size), so four strip blits cost ~4x as much.
    int bw = w + 8, bh = h + 8;
    var bmi = new BITMAPINFOHEADER { Size = 40, Width = bw, Height = -bh, Planes = 1, BitCount = 32 };
    IntPtr screen = GetDC(IntPtr.Zero), mem = CreateCompatibleDC(screen), bits;
    IntPtr bmp = CreateDIBSection(screen, ref bmi, 0, out bits, IntPtr.Zero, 0), old = IntPtr.Zero;
    try {
      if (bmp != IntPtr.Zero) old = SelectObject(mem, bmp);
      if (bmp == IntPtr.Zero || !BitBlt(mem, 0, 0, bw, bh, screen, x - 4, y - 4, SrcCopy)) leftIn = rightIn = topIn = bottomIn = false;
      GdiFlush();
      return new Json().Add("strips", id)
        .Raw("left", leftIn ? Sample(bits, bw, 0, 4, 0, 1, h, cols) : "null")
        .Raw("right", rightIn ? Sample(bits, bw, w + 7, 4, 0, 1, h, cols) : "null")
        .Raw("top", topIn ? Sample(bits, bw, 4, 0, 1, 0, w, rows) : "null")
        .Raw("bottom", bottomIn ? Sample(bits, bw, 4, h + 7, 1, 0, w, rows) : "null")
        .Add("cols", cols).Add("rows", rows).ToString();
    } finally {
      if (old != IntPtr.Zero) SelectObject(mem, old);
      if (bmp != IntPtr.Zero) DeleteObject(bmp);
      DeleteDC(mem);
      ReleaseDC(IntPtr.Zero, screen);
    }
  }

  // nearest-pixel downsample of a 1-px line (start x0,y0, step dx,dy, len pixels) to BGRA samples
  static string Sample(IntPtr bits, int stride, int x0, int y0, int dx, int dy, int len, int samples) {
    var px = new byte[samples * 4];
    for (int i = 0; i < samples; i++) {
      int k = (int)((i + .5) * len / samples);
      Marshal.Copy(IntPtr.Add(bits, ((y0 + dy * k) * stride + x0 + dx * k) * 4), px, i * 4, 4);
    }
    return "\"" + Convert.ToBase64String(px) + "\"";
  }
}

static class Brightness {
  // laptop panels only (WMI); -1 when the screen has no software brightness
  public static int Get() {
    try {
      using (var s = new ManagementObjectSearcher("root\\WMI", "SELECT CurrentBrightness FROM WmiMonitorBrightness"))
        foreach (ManagementObject o in s.Get()) return Convert.ToInt32(o["CurrentBrightness"]);
    } catch { }
    return -1;
  }
  public static void Set(int v) {
    try {
      using (var s = new ManagementObjectSearcher("root\\WMI", "SELECT * FROM WmiMonitorBrightnessMethods"))
        foreach (ManagementObject o in s.Get()) { o.InvokeMethod("WmiSetBrightness", new object[] { (uint)1, (byte)v }); return; }
    } catch { }
  }
}

// Minimal JSON writer for one flat object per line.
class Json {
  readonly StringBuilder sb = new StringBuilder("{");
  bool first = true;
  void Key(string k) { if (!first) sb.Append(','); first = false; Str(k); sb.Append(':'); }
  void Str(string s) {
    sb.Append('"');
    foreach (char c in s ?? "") {
      switch (c) {
        case '"': sb.Append("\\\""); break;
        case '\\': sb.Append("\\\\"); break;
        case '\n': sb.Append("\\n"); break;
        case '\r': sb.Append("\\r"); break;
        case '\t': sb.Append("\\t"); break;
        default:
          if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4")); else sb.Append(c);
          break;
      }
    }
    sb.Append('"');
  }
  public Json Add(string k, string v) { Key(k); Str(v); return this; }
  public Json Add(string k, bool v) { Key(k); sb.Append(v ? "true" : "false"); return this; }
  public Json Add(string k, int v) { Key(k); sb.Append(v.ToString(CultureInfo.InvariantCulture)); return this; }
  public Json Raw(string k, string json) { Key(k); sb.Append(json); return this; }
  public Json Add(string k, double v) { Key(k); sb.Append(Math.Round(v, 3).ToString(CultureInfo.InvariantCulture)); return this; }
  public override string ToString() { return sb.ToString() + "}"; }
}

static class Program {
  static GlobalSystemMediaTransportControlsSessionManager mgr;
  static readonly BlockingCollection<string> commands = new BlockingCollection<string>();
  static TextWriter outw;
  static GlobalSystemMediaTransportControlsSession watched;
  static int mediaQueued;
  static int metadataDirty = 1;
  static bool privacyEnabled;
  static DateTime nextPrivacy;
  static void QueueMedia() {
    if (Interlocked.Exchange(ref mediaQueued, 1) == 0) commands.Add("@media");
  }
  static void MediaChanged(GlobalSystemMediaTransportControlsSession sender, MediaPropertiesChangedEventArgs args) {
    Interlocked.Exchange(ref metadataDirty, 1);
    QueueMedia();
  }
  static void PlaybackChanged(GlobalSystemMediaTransportControlsSession sender, PlaybackInfoChangedEventArgs args) { QueueMedia(); }
  // timeline events come in bursts (seek, track change): coalesce them into one status line
  static int timelinePending;
  static readonly Timer timelineTimer = new Timer(state => { Interlocked.Exchange(ref timelinePending, 0); QueueMedia(); });
  static void TimelineChanged(GlobalSystemMediaTransportControlsSession sender, TimelinePropertiesChangedEventArgs args) {
    if (Interlocked.Exchange(ref timelinePending, 1) == 0) timelineTimer.Change(60, Timeout.Infinite);
  }
  // Which session the island shows (upstream 1.8.3): a playing one wins (latest to start, else
  // the system's current); with none playing, keep the one already shown while it exists, so a
  // paused player is not replaced by a paused browser video; only then fall back to the current
  // session, preferring a non-browser app.
  static readonly string[] BrowserIds = { "chrome", "msedge", "brave", "opera", "vivaldi", "firefox" };
  static readonly Dictionary<string, DateTime> playingSince = new Dictionary<string, DateTime>();
  static GlobalSystemMediaTransportControlsSession shown;
  static bool IsBrowser(string id) {
    id = (id ?? "").ToLowerInvariant();
    foreach (var b in BrowserIds) if (id.Contains(b)) return true;
    return false;
  }
  static GlobalSystemMediaTransportControlsSession Pick() {
    if (mgr == null) return null;
    GlobalSystemMediaTransportControlsSession current = null, playing = null, kept = null, app = null;
    try { current = mgr.GetCurrentSession(); } catch { }
    string currentId = current == null ? null : current.SourceAppUserModelId;
    string shownId = shown == null ? null : shown.SourceAppUserModelId;
    var now = DateTime.UtcNow;
    var best = DateTime.MinValue;
    var seen = new HashSet<string>();
    try {
      foreach (var x in mgr.GetSessions()) {
        string id = x.SourceAppUserModelId ?? "";
        seen.Add(id);
        bool on = false;
        try {
          var info = x.GetPlaybackInfo();
          on = info != null && info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
        } catch { }
        if (on) {
          DateTime since;
          if (!playingSince.TryGetValue(id, out since)) playingSince[id] = since = now;
          if (playing == null || since > best || (since == best && id == currentId)) { playing = x; best = since; }
        } else playingSince.Remove(id);
        if (kept == null && shownId != null && id == shownId) kept = x;
        if (app == null && !IsBrowser(id)) app = x;
      }
    } catch { return shown = current; }
    foreach (var id in new List<string>(playingSince.Keys)) if (!seen.Contains(id)) playingSince.Remove(id);
    if (playing != null) return shown = playing;
    if (kept != null) return shown = kept;
    return shown = current != null && !IsBrowser(currentId) ? current : app ?? current;
  }

  static bool Watch(GlobalSystemMediaTransportControlsSession session) {
    // same app id = same session: GetSessions/GetCurrentSession may hand back different wrappers
    if (object.Equals(watched, session) || (watched != null && session != null &&
        watched.SourceAppUserModelId == session.SourceAppUserModelId)) return false;
    if (watched != null) {
      try { watched.MediaPropertiesChanged -= MediaChanged; watched.PlaybackInfoChanged -= PlaybackChanged; watched.TimelinePropertiesChanged -= TimelineChanged; } catch { }
    }
    watched = session;
    if (watched != null) {
      try { watched.MediaPropertiesChanged += MediaChanged; watched.PlaybackInfoChanged += PlaybackChanged; watched.TimelinePropertiesChanged += TimelineChanged; } catch { }
    }
    return true;
  }

  static void ReadActiveDevices(RegistryKey key, List<string> active) {
    object stop = key.GetValue("LastUsedTimeStop");
    if (stop is long && (long)stop == 0) active.Add(JsonStr(key.Name));
    foreach (var child in key.GetSubKeyNames()) {
      using (var sub = key.OpenSubKey(child)) {
        if (sub != null) ReadActiveDevices(sub, active);
      }
    }
  }
  static string ActiveDevices(string device) {
    var active = new List<string>();
    try {
      using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\" + device)) {
        if (key != null) ReadActiveDevices(key, active);
      }
    } catch { }
    return "[" + string.Join(",", active) + "]";
  }

  // Waits on a WinRT operation through its own Status/GetResults: the AsTask bridge would need
  // the Windows SDK's union Windows.winmd, which the compiler that ships with Windows lacks.
  static T Await<T>(Windows.Foundation.IAsyncOperation<T> op, int ms = 3000) {
    if (op == null) return default(T);
    try {
      var until = DateTime.UtcNow.AddMilliseconds(ms);
      while (op.Status == Windows.Foundation.AsyncStatus.Started) {
        if (DateTime.UtcNow > until) { op.Cancel(); return default(T); }
        Thread.Sleep(10);
      }
      return op.Status == Windows.Foundation.AsyncStatus.Completed ? op.GetResults() : default(T);
    } catch { return default(T); }
  }

  static GlobalSystemMediaTransportControlsSession Find(string appId) {
    if (mgr == null) return null;
    foreach (var s in mgr.GetSessions()) if (s.SourceAppUserModelId == appId) return s;
    return null;
  }

  static string Thumb(GlobalSystemMediaTransportControlsSessionMediaProperties props) {
    if (props == null || props.Thumbnail == null) return "";
    try {
      using (var s = Await(props.Thumbnail.OpenReadAsync())) {
        if (s == null || s.Size == 0) return "";
        var reader = new DataReader(s.GetInputStreamAt(0));
        uint n = Await(reader.LoadAsync((uint)s.Size));
        if (n == 0) return "";
        var bytes = new byte[n];
        reader.ReadBytes(bytes);
        reader.Dispose();
        return Convert.ToBase64String(bytes);
      }
    } catch { return ""; }
  }

  static readonly Regex AppCmd = new Regex(@"^(pauseapp|playapp) (\S+)$");
  static readonly Regex SeekApp = new Regex(@"^seekapp (\S+) (\d+(\.\d+)?)$");
  static readonly Regex Vol = new Regex(@"^vol (\d+(\.\d+)?)$");
  static readonly Regex Bright = new Regex(@"^bright (\d+)$");
  static readonly Regex Seek = new Regex(@"^seek (\d+(\.\d+)?)$");
  static double Num(string s) { return double.Parse(s, CultureInfo.InvariantCulture); }

  static int bright = -1;
  static bool vlcShown; // the island is showing VLC, so play/pause/next/prev go to it

  static void Handle(string cmd) {
    if (cmd == "@media") { Interlocked.Exchange(ref mediaQueued, 0); return; }
    if (cmd == "privacy 1" || cmd == "privacy 0") {
      privacyEnabled = cmd == "privacy 1";
      nextPrivacy = DateTime.MinValue;
      return;
    }
    Match m;
    if (cmd.StartsWith("focusapp	") || cmd.StartsWith("runningapps	")) { AppCommand(cmd); return; }
    if ((m = AppCmd.Match(cmd)).Success) {
      var t = Find(m.Groups[2].Value);
      if (t != null) Await(m.Groups[1].Value == "pauseapp" ? t.TryPauseAsync() : t.TryPlayAsync());
      return;
    }
    if ((m = SeekApp.Match(cmd)).Success) {
      var t = Find(m.Groups[1].Value);
      if (t != null) Await(t.TryChangePlaybackPositionAsync((long)(Num(m.Groups[2].Value) * 10000000)));
      return;
    }
    if ((m = Vol.Match(cmd)).Success) {
      float v = (float)Math.Min(1, Math.Max(0, Num(m.Groups[1].Value)));
      try { Audio.SetVolume(v); } catch { }
      return;
    }
    if (cmd == "mute") { try { Audio.ToggleMute(); } catch { } return; }
    if ((m = Bright.Match(cmd)).Success) {
      bright = Math.Min(100, int.Parse(m.Groups[1].Value));
      Brightness.Set(bright);
      return;
    }
    if (vlcShown && (cmd == "toggle" || cmd == "next" || cmd == "prev")) { Vlc.Command(cmd); return; }
    var s = shown; // controls act on the session the island shows
    if (s == null) return;
    if ((m = Seek.Match(cmd)).Success) { Await(s.TryChangePlaybackPositionAsync((long)(Num(m.Groups[1].Value) * 10000000))); return; }
    if (cmd == "toggle") Await(s.TryTogglePlayPauseAsync());
    else if (cmd == "next") Await(s.TrySkipNextAsync());
    else if (cmd == "prev") Await(s.TrySkipPreviousAsync());
  }

  static string JsonStr(string s) {
    return new Json().Add("s", s).ToString().Substring(5).TrimEnd('}');
  }

  // Apps tab: focus an app's open window, or list which pinned apps are running
  static void AppCommand(string cmd) {
    var parts = cmd.Split('	');
    if (parts[0] == "focusapp") {
      string id = parts.Length > 1 ? parts[1] : "", exe = parts.Length > 2 ? parts[2] : "";
      string result = "none";
      try { if (id != "") result = AppWindows.Focus(id, exe); } catch { }
      outw.WriteLine(new Json().Add("focusapp", id).Add("result", result).ToString());
      return;
    }
    var apps = new System.Collections.Generic.List<string[]>();
    for (int i = 1; i < parts.Length; i += 2) apps.Add(new[] { parts[i], i + 1 < parts.Length ? parts[i + 1] : "" });
    var on = new System.Collections.Generic.List<string>();
    try { on = AppWindows.Running(apps); } catch { }
    var items = new System.Collections.Generic.List<string>();
    foreach (var id in on) items.Add(JsonStr(id));
    outw.WriteLine("{\"running\":[" + string.Join(",", items) + "]}");
  }

  // one-shot commands (shell and UI Automation want a single-threaded apartment)
  static int RunSta(Action<TextWriter> job) {
    var w = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
    int code = 0;
    var t = new Thread(() => {
      try { job(w); } catch (Exception e) { Console.Error.WriteLine(e.Message); code = 1; }
    });
    t.SetApartmentState(ApartmentState.STA);
    t.Start();
    t.Join();
    return code;
  }

  //   nova-helper                    -> the media/system bridge (JSON lines, commands on stdin)
  //   nova-helper apps               -> Start menu apps as JSON
  //   nova-helper yturl <proc> <title> -> URL of the browser tab playing that video
  [MTAThread]
  static int Main(string[] args) {
    Win.PerMonitorDpi();
    if (args.Length >= 1 && args[0] == "apps") return RunSta(w => Apps.Print(w));
    if (args.Length >= 2 && args[0] == "yturl") return RunSta(w => YtUrl.Print(w, args[1], args.Length > 2 ? args[2] : ""));
    outw = TextWriter.Synchronized(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
    WindowState.Start(outw);
    AudioBands.Start(outw);
    mgr = Await(GlobalSystemMediaTransportControlsSessionManager.RequestAsync(), 8000);
    if (mgr == null) outw.WriteLine("{\"error\":\"smtc-unavailable\"}");
    else { try { mgr.CurrentSessionChanged += (sender, e) => QueueMedia(); mgr.SessionsChanged += (sender, e) => QueueMedia(); Watch(mgr.GetCurrentSession()); } catch { } }

    // stdin on its own thread; when the island closes the pipe, exit
    var reader = new Thread(() => {
      var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
      string line;
      while ((line = stdin.ReadLine()) != null) {
        line = line.Trim();
        if (line == "meter on" || line == "meter off") AudioBands.SetEnabled(line == "meter on");
        else if (line.StartsWith("strips ")) {
          // answered here, not on the command loop, so it does not also trigger a full status line
          var p = line.Split(' ');
          int id, x, y, w, h;
          if (p.Length == 6 && int.TryParse(p[1], out id) && int.TryParse(p[2], out x) && int.TryParse(p[3], out y) &&
              int.TryParse(p[4], out w) && int.TryParse(p[5], out h) && w > 0 && h > 0) {
            try { outw.WriteLine(Strips.Line(id, x, y, w, h)); } catch (IOException) { Environment.Exit(0); } catch { }
          }
        }
        else commands.Add(line);
      }
      Environment.Exit(0);
    }) { IsBackground = true };
    reader.Start();

    string lastKey = null, prevThumb = "";
    bool thumbOk = false;
    int thumbTries = 0;
    bright = Brightness.Get();
    bool brightOk = bright >= 0;
    bool rec = false;
    var next = DateTime.UtcNow;
    var nextBrightness = next.AddSeconds(2);
    var nextRecorder = next;
    var nextMetadata = DateTime.MinValue;
    GlobalSystemMediaTransportControlsSessionMediaProperties props = null;

    while (true) {
      // run commands as they come; report right after one so the island sees the effect
      string cmd;
      bool acted = false;
      while (commands.TryTake(out cmd, acted || DateTime.UtcNow >= next ? 0 : Math.Max(0, (int)(next - DateTime.UtcNow).TotalMilliseconds))) {
        try { Handle(cmd); } catch { }
        acted = true;
      }
      if (!acted && DateTime.UtcNow < next) continue;
      next = DateTime.UtcNow.AddMilliseconds(500);

      var o = new Json();
      var s = Pick();
      if (Watch(s)) {
        props = null;
        nextMetadata = DateTime.MinValue;
      }
      // VLC (no media session): shown while it plays and the session isn't playing,
      // or paused with no session at all
      bool vlcPlaying = false;
      vlcShown = false;
      try {
        if (Vlc.Find()) {
          vlcPlaying = Vlc.Playing();
          var si = s == null ? null : s.GetPlaybackInfo();
          bool sessionPlaying = si != null && si.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
          vlcShown = vlcPlaying ? !sessionPlaying : s == null;
        }
      } catch { }
      if (vlcShown) {
        o.Add("has", true).Add("title", Vlc.Title).Add("artist", "").Add("album", "")
         .Add("app", "vlc.exe").Add("playing", vlcPlaying).Add("pos", 0).Add("dur", 0);
        string key = Vlc.Title + "||vlc.exe";
        if (key != lastKey) { lastKey = key; o.Add("thumb", ""); }
        thumbOk = true;
      } else if (s != null) {
        if (Interlocked.Exchange(ref metadataDirty, 0) != 0 || DateTime.UtcNow >= nextMetadata) {
          var updated = Await(s.TryGetMediaPropertiesAsync(), 800);
          if (updated != null) props = updated;
          nextMetadata = DateTime.UtcNow.AddSeconds(updated != null && thumbOk ? 5 : 1);
        }
        var info = s.GetPlaybackInfo();
        var tl = s.GetTimelineProperties();
        bool playing = info != null && info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
        double pos = tl.Position.TotalSeconds;
        double dur = (tl.EndTime - tl.StartTime).TotalSeconds;
        if (playing && dur > 0) {
          pos += (DateTimeOffset.Now - tl.LastUpdatedTime).TotalSeconds;
          if (pos > dur) pos = dur;
        }
        string title = props == null ? "" : props.Title, artist = props == null ? "" : props.Artist;
        string app = s.SourceAppUserModelId ?? "";
        o.Add("has", true).Add("title", title).Add("artist", artist).Add("album", props == null ? "" : props.AlbumTitle)
         .Add("app", app).Add("playing", playing).Add("pos", Math.Round(pos, 2)).Add("dur", Math.Round(dur, 2));

        // browsers publish the thumbnail after the title, so keep retrying for ~10 s
        string key = title + "|" + artist + "|" + app;
        if (key != lastKey) { lastKey = key; thumbOk = false; thumbTries = 0; o.Add("thumb", ""); }
        if (!thumbOk && thumbTries < 20) {
          thumbTries++;
          string t = Thumb(props);
          // identical to the previous track's thumbnail is usually stale: wait a little longer
          if (t != "" && (t != prevThumb || thumbTries >= 8)) { o.Add("thumb", t); prevThumb = t; thumbOk = true; }
        }
      } else {
        o.Add("has", false);
        lastKey = null;
      }

      try {
        float volume;
        bool muted;
        Audio.Read(out volume, out muted);
        o.Add("vol", Math.Round(volume, 3)).Add("muted", muted);
      } catch { }
      if (brightOk && DateTime.UtcNow >= nextBrightness) { bright = Brightness.Get(); nextBrightness = DateTime.UtcNow.AddSeconds(2); }
      o.Add("bright", brightOk ? bright : -1);
      try { o.Add("kl", Win.KeyboardLayout()).Add("caps", Win.CapsLock()); } catch { }
      try { long seq = Win.ClipboardSeq(); o.Add("clip", (double)seq).Add("clipPriv", Win.ClipboardPrivate(seq)); } catch { }
      try { o.Add("idle", Win.IdleSeconds()); } catch { }
      try { int pct; bool ac; Win.Battery(out pct, out ac); o.Add("bat", pct).Add("ac", ac); } catch { }
      if (DateTime.UtcNow >= nextRecorder) { try { rec = Win.RecorderRunning(); } catch { } nextRecorder = DateTime.UtcNow.AddSeconds(2); }
      o.Add("rec", rec);
      if (privacyEnabled && DateTime.UtcNow >= nextPrivacy) {
        nextPrivacy = DateTime.UtcNow.AddSeconds(2);
        o.Raw("privacy", new Json().Raw("mic", ActiveDevices("microphone")).Raw("cam", ActiveDevices("webcam")).ToString());
      }
      try { string proc, title; Win.Foreground(Win.ForegroundHandle(), out proc, out title); o.Add("fgProc", proc).Add("fgTitle", title); } catch { }

      try { outw.WriteLine(o.ToString()); } catch (IOException) { return 0; }
    }
  }
}
