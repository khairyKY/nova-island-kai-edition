// `nova-helper apps`: the Start menu's apps as JSON, [{ name, id, icon, kind }] (was apps.ps1).
//   id   = AppUserModelID from the shell's AppsFolder (launched with shell:AppsFolder\<id>)
//   kind = 'png' (Store app logo file) | 'file' (exe/lnk to take the icon from) | ''
//   image = embedded PNG data URL when an icon resource can be read directly
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Xml;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using Microsoft.Win32;

static class Apps {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern int SHDefExtractIcon(string file, int index, uint flags, out IntPtr large, IntPtr small, uint size);
  [DllImport("user32.dll")]
  static extern bool DestroyIcon(IntPtr icon);

  // Read the app's actual icon resource, bypassing stale generic Shell icon-cache entries.
  static string ResourceIcon(string file, int index) {
    IntPtr handle = IntPtr.Zero;
    try {
      if (!File.Exists(file) || SHDefExtractIcon(file, index, 0, out handle, IntPtr.Zero, 64) != 0 || handle == IntPtr.Zero) return "";
      using (var icon = Icon.FromHandle(handle))
      using (var bitmap = icon.ToBitmap())
      using (var stream = new MemoryStream()) {
        bitmap.Save(stream, ImageFormat.Png);
        return "data:image/png;base64," + Convert.ToBase64String(stream.ToArray());
      }
    } catch { return ""; }
    finally { if (handle != IntPtr.Zero) DestroyIcon(handle); }
  }

  static string ShortcutImage(dynamic wsh, string link) {
    try {
      string location = wsh.CreateShortcut(link).IconLocation;
      int index = 0;
      int comma = location.LastIndexOf(',');
      int parsed;
      if (comma >= 0 && int.TryParse(location.Substring(comma + 1).Trim(), out parsed)) {
        index = parsed;
        location = location.Substring(0, comma);
      }
      location = Environment.ExpandEnvironmentVariables(location.Trim().Trim('"'));
      return ResourceIcon(location, index);
    } catch { return ""; }
  }

  // package family name -> install folder, from the per-user package repository
  static Dictionary<string, string> Packages() {
    var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    var versions = new Dictionary<string, Version>(StringComparer.OrdinalIgnoreCase);
    const string root = @"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages";
    using (var key = Registry.CurrentUser.OpenSubKey(root)) {
      if (key == null) return map;
      foreach (string full in key.GetSubKeyNames()) {
        // full name: Name_Version_Arch_ResourceId_PublisherId  ->  family: Name_PublisherId
        var parts = full.Split('_');
        if (parts.Length < 5) continue;
        // resource packs (ResourceId like "split.scale-100", "split.language-ar") hold no apps
        if (parts[3].StartsWith("split.", StringComparison.OrdinalIgnoreCase)) continue;
        string family = parts[0] + "_" + parts[parts.Length - 1];
        Version v;
        if (!Version.TryParse(parts[1], out v)) v = new Version(0, 0);
        Version have;
        if (versions.TryGetValue(family, out have) && have >= v) continue; // keep the newest
        using (var sub = key.OpenSubKey(full)) {
          var folder = sub == null ? null : sub.GetValue("PackageRootFolder") as string;
          if (string.IsNullOrEmpty(folder) || !File.Exists(Path.Combine(folder, "AppxManifest.xml"))) continue;
          map[family] = folder;
          versions[family] = v;
        }
      }
    }
    return map;
  }

  // Start menu shortcuts by display name (first one wins)
  static Dictionary<string, string> Links() {
    var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    var dirs = new[] {
      Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu), "Programs"),
      Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs"),
    };
    foreach (var d in dirs) {
      if (!Directory.Exists(d)) continue;
      IEnumerable<string> files;
      try { files = Directory.EnumerateFiles(d, "*.lnk", SearchOption.AllDirectories); } catch { continue; }
      foreach (var f in files) {
        string name = Path.GetFileNameWithoutExtension(f);
        if (!map.ContainsKey(name)) map[name] = f;
      }
    }
    return map;
  }

  // the best-looking logo in a package: 48px unplated first, never high-contrast
  static string FindLogo(string location, string appId) {
    try {
      var doc = new XmlDocument();
      doc.Load(Path.Combine(location, "AppxManifest.xml"));
      // (C# 5: the compiler that ships with Windows)
      var visual = doc.SelectSingleNode("//*[local-name()='Application'][@Id='" + appId.Replace("'", "") + "']/*[local-name()='VisualElements']/@Square44x44Logo");
      var props = doc.SelectSingleNode("//*[local-name()='Properties']/*[local-name()='Logo']");
      string logo = visual != null ? visual.Value : props != null ? props.InnerText : null;
      if (string.IsNullOrEmpty(logo)) return "";
      string dir = Path.Combine(location, Path.GetDirectoryName(logo) ?? "");
      string baseName = Path.GetFileNameWithoutExtension(logo);
      string best = null;
      int bestScore = -1;
      if (Directory.Exists(dir)) {
        foreach (var f in Directory.EnumerateFiles(dir, baseName + "*.png")) {
          string n = Path.GetFileName(f).ToLowerInvariant();
          int score = 1;
          if (n.Contains("targetsize-48_altform-unplated")) score = 10;
          else if (n.Contains("targetsize-64_altform-unplated")) score = 9;
          else if (n.Contains("targetsize-48")) score = 8;
          else if (n.Contains("altform-unplated")) score = 7;
          else if (n.Contains("scale-200")) score = 6;
          else if (n.Contains("scale-100")) score = 5;
          if (n.Contains("contrast")) score = 0;
          if (score > bestScore) { best = f; bestScore = score; }
        }
      }
      if (best != null) return best;
      string direct = Path.Combine(location, logo);
      return File.Exists(direct) ? direct : "";
    } catch { return ""; }
  }

  static string ShortcutTarget(dynamic wsh, string lnk) {
    try { return (string)wsh.CreateShortcut(lnk).TargetPath; } catch { return ""; }
  }

  static string Str(string s) {
    var sb = new StringBuilder("\"");
    foreach (char c in s ?? "") {
      if (c == '"') sb.Append("\\\"");
      else if (c == '\\') sb.Append("\\\\");
      else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
      else sb.Append(c);
    }
    return sb.Append('"').ToString();
  }

  public static void Print(TextWriter outw) {
    var packages = Packages();
    var links = Links();
    dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));
    dynamic wsh = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
    dynamic folder = shell.NameSpace("shell:AppsFolder");
    var rows = new List<string>();
    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (dynamic item in folder.Items()) {
      string name = item.Name;
      string id = item.Path;
      if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(id) || !seen.Add(id)) continue;
      string icon = "", kind = "", image = "";
      int bang = id.IndexOf('!');
      string loc;
      if (bang > 0 && packages.TryGetValue(id.Substring(0, bang), out loc)) {
        icon = FindLogo(loc, id.Substring(bang + 1));
        if (icon != "") kind = "png";
      }
      string lnk;
      if (icon == "" && links.TryGetValue(name, out lnk)) {
        string target = ShortcutTarget(wsh, lnk);
        // a shortcut may point to a folder too (e.g. "XAMPP htdocs folder")
        icon = !string.IsNullOrEmpty(target) && (File.Exists(target) || Directory.Exists(target)) ? target : lnk;
        kind = "file";
        image = ShortcutImage(wsh, lnk);
      }
      if (icon == "" && File.Exists(id)) { icon = id; kind = "file"; }
      if (image == "" && kind == "file") image = ResourceIcon(icon, 0);
      rows.Add("{\"name\":" + Str(name) + ",\"id\":" + Str(id) + ",\"icon\":" + Str(icon) + ",\"kind\":" + Str(kind) + ",\"image\":" + Str(image) + "}");
    }
    outw.WriteLine("[" + string.Join(",", rows) + "]");
  }
}
