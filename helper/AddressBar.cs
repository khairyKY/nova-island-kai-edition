// The address bar ("omnibox") of a Chromium browser in front, in physical screen coordinates.
// The UI Automation search for it is slow-ish, so it is done once per browser window (retried
// every 2 s if not found); after that only the element's properties are read each tick.
using System;
using System.Windows;
using System.Windows.Automation;

static class AddressBar {
  static readonly string[] Browsers = { "chrome", "msedge", "brave", "opera", "vivaldi" };
  static IntPtr hwnd = IntPtr.Zero;
  static AutomationElement edit;
  static DateTime nextSearch = DateTime.MinValue;

  // JSON object for the bridge line, or "null" when no browser address bar is in front
  public static string Json(IntPtr fg, string proc, bool fullscreen) {
    bool opera = string.Equals(proc, "opera", StringComparison.OrdinalIgnoreCase);
    if (fullscreen || fg == IntPtr.Zero || Array.IndexOf(Browsers, (proc ?? "").ToLowerInvariant()) < 0 || Win.ClassOf(fg) != "Chrome_WidgetWin_1") {
      hwnd = IntPtr.Zero;
      edit = null;
      return "null";
    }
    // Opera's accessibility provider can block while a window is activating.
    // Keep the window-state thread on native bounds/caret queries for GX.
    if (opera) {
      hwnd = IntPtr.Zero;
      edit = null;
      return OperaToolbar(fg);
    }
    if (fg != hwnd) {
      hwnd = fg;
      edit = null;
      nextSearch = DateTime.MinValue;
    }
    if (edit == null && DateTime.UtcNow >= nextSearch) {
      nextSearch = DateTime.UtcNow.AddSeconds(2);
      try {
        edit = AutomationElement.FromHandle(fg).FindFirst(TreeScope.Descendants,
          new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit));
      } catch { edit = null; }
    }
    if (edit != null) {
      try {
        var current = edit.Current;
        var r = current.BoundingRectangle;
        if (!current.IsOffscreen && !r.IsEmpty && r.Width >= 200 && r.Height >= 16)
          return Bar(r, current.HasKeyboardFocus, false);
      } catch { }
      edit = null; // The control was replaced, hidden, or belonged to the page.
    }
    return "null";
  }

  static string OperaToolbar(IntPtr fg) {
    // Opera GX's custom chrome exposes no Edit in UI Automation on some builds. Leave room for
    // its sidebar, navigation and extensions. Align from the visible client area so the
    // resize border on a restored window does not shift the toolbar estimate.
    Win.RECT bounds;
    if (!Win.VisibleBounds(fg, out bounds)) return "null";
    Win.RECT client;
    if (Win.ClientBounds(fg, out client)) {
      bounds.L = Math.Max(bounds.L, client.L);
      bounds.T = Math.Max(bounds.T, client.T);
      bounds.R = Math.Min(bounds.R, client.R);
      bounds.B = Math.Min(bounds.B, client.B);
    }
    double scale = Win.DpiScale(fg);
    double width = bounds.R - bounds.L;
    if (width < 720 * scale || bounds.B - bounds.T < 160 * scale) return "null";
    double left = bounds.L + 205 * scale;
    double right = bounds.R - Math.Min(300 * scale, width * .28);
    // Maximized GX retains a native top-frame inset in its custom tab strip.
    // Use the actual inset in physical pixels, including its current DPI.
    double top = bounds.T + Win.MaximizedTopInset(fg) + 34 * scale;
    var r = new Rect(left, top, right - left, 29 * scale);
    return Bar(r, Win.CaretIn(fg, r), true);
  }

  static string Bar(Rect r, bool focus, bool estimated) {
    return new Json().Add("x", (int)r.X).Add("y", (int)r.Y).Add("w", (int)r.Width)
      .Add("h", (int)r.Height).Add("focus", focus).Add("estimated", estimated).ToString();
  }
}
