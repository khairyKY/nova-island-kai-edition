// Windows app notifications mirrored onto the island. UserNotificationListener's change event
// needs package identity, so the toast list is polled once a second on its own thread; toasts
// already there when it starts are not replayed.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading;
using Windows.UI.Notifications;
using Windows.UI.Notifications.Management;

static class AppNotify {
  static int generation;
  static readonly Regex Aumid = new Regex(@"^[A-Za-z0-9._!\-\\]+$");
  // per AUMID: logo as a data URL and its accent ("[r,g,b]" or "null"); only touched on the poll thread
  static readonly Dictionary<string, string[]> looks = new Dictionary<string, string[]>();

  public static void Command(string arg, TextWriter output) {
    if (arg == "on") {
      int mine = Interlocked.Increment(ref generation);
      var t = new Thread(() => Poll(mine, output)) { IsBackground = true };
      t.SetApartmentState(ApartmentState.MTA);
      t.Start();
    } else if (arg == "off") {
      Interlocked.Increment(ref generation);
    } else if (arg.StartsWith("open ")) {
      string aumid = arg.Substring(5).Trim();
      if (Aumid.IsMatch(aumid)) ThreadPool.QueueUserWorkItem(state => Open(aumid));
    }
  }

  static void Open(string aumid) {
    try {
      if (AppWindows.Focus(aumid, "") == "focused") return;
      Process.Start("explorer.exe", "shell:AppsFolder\\" + aumid);
    } catch { }
  }

  static void Poll(int mine, TextWriter output) {
    try {
      var listener = UserNotificationListener.Current;
      var access = Program.Await(listener.RequestAccessAsync(), 10000);
      string state = access == UserNotificationListenerAccessStatus.Allowed ? "allowed"
        : access == UserNotificationListenerAccessStatus.Denied ? "denied" : "unspecified";
      output.WriteLine(new Json().Add("appnotifyAccess", state).ToString());
      if (state != "allowed") return;
      HashSet<uint> seen = null;
      while (mine == Thread.VolatileRead(ref generation)) {
        var list = Program.Await(listener.GetNotificationsAsync(NotificationKinds.Toast), 3000);
        if (list != null) {
          var now = new HashSet<uint>();
          foreach (var n in list) {
            now.Add(n.Id);
            if (seen == null || seen.Contains(n.Id)) continue;
            string line = Line(n);
            if (line != null && mine == Thread.VolatileRead(ref generation)) output.WriteLine(line);
          }
          seen = now; // only ids still in the Action Center, so the set never outgrows it
        }
        Thread.Sleep(1000);
      }
    } catch (IOException) { }
    catch {
      try { output.WriteLine(new Json().Add("appnotifyAccess", "unspecified").ToString()); } catch { }
    }
  }

  static string Line(UserNotification n) {
    try {
      var app = n.AppInfo;
      string aumid = app == null ? "" : app.AppUserModelId ?? "";
      string name = app == null ? "" : app.DisplayInfo.DisplayName ?? "";
      if (aumid.IndexOf("nova-island", StringComparison.OrdinalIgnoreCase) >= 0 ||
          name.StartsWith("Nova Island", StringComparison.OrdinalIgnoreCase)) return null; // our own
      var binding = n.Notification.Visual.GetBinding(KnownNotificationBindings.ToastGeneric);
      if (binding == null) return null;
      string title = "";
      var body = new List<string>();
      foreach (var t in binding.GetTextElements()) {
        string text = (t.Text ?? "").Trim();
        if (text == "") continue;
        if (title == "") title = text; else body.Add(text);
      }
      if (title == "" && body.Count == 0) return null;
      var look = Look(app, aumid);
      var note = new Json().Raw("id", n.Id.ToString()).Add("app", name).Add("aumid", aumid)
        .Add("title", title).Add("body", string.Join(" ", body)).Add("icon", look[0]).Raw("rgb", look[1]);
      return new Json().Raw("appnote", note.ToString()).ToString();
    } catch { return null; }
  }

  static string[] Look(Windows.ApplicationModel.AppInfo app, string aumid) {
    string[] look;
    if (looks.TryGetValue(aumid, out look)) return look;
    look = new[] { "", "null" };
    try {
      var bytes = Program.Bytes(app.DisplayInfo.GetLogo(new Windows.Foundation.Size(32, 32)));
      if (bytes != null) {
        using (var src = new Bitmap(new MemoryStream(bytes)))
        using (var icon = new Bitmap(src, 32, 32)) {
          using (var png = new MemoryStream()) {
            icon.Save(png, ImageFormat.Png);
            look[0] = "data:image/png;base64," + Convert.ToBase64String(png.ToArray());
          }
          look[1] = Accent(icon);
        }
      }
    } catch { }
    looks[aumid] = look;
    return look;
  }

  // mean of the logo's opaque, coloured pixels, pushed to a usable saturation and lightness
  static string Accent(Bitmap b) {
    double r = 0, g = 0, bl = 0;
    int count = 0;
    for (int y = 0; y < b.Height; y++)
      for (int x = 0; x < b.Width; x++) {
        var c = b.GetPixel(x, y); // ponytail: GetPixel is fine for 32x32, once per app
        if (c.A < 200) continue;
        int max = Math.Max(c.R, Math.Max(c.G, c.B)), min = Math.Min(c.R, Math.Min(c.G, c.B));
        if (min > 230 || max < 25) continue; // near-white / near-black
        r += c.R; g += c.G; bl += c.B; count++;
      }
    if (count == 0) return "null";
    var mean = Color.FromArgb((int)(r / count), (int)(g / count), (int)(bl / count));
    double h = mean.GetHue() / 360, s = Math.Max(mean.GetSaturation(), .55);
    double l = Math.Min(.6, Math.Max(.4, mean.GetBrightness()));
    double q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return "[" + Channel(p, q, h + 1 / 3.0) + "," + Channel(p, q, h) + "," + Channel(p, q, h - 1 / 3.0) + "]";
  }

  // HSL to one RGB channel
  static int Channel(double p, double q, double t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    double v = t < 1 / 6.0 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3.0 ? p + (q - p) * (2 / 3.0 - t) * 6 : p;
    return (int)Math.Round(v * 255);
  }
}
