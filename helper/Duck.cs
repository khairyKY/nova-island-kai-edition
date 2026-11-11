// Ducking for the adhan: every other app's sound fades down while it's on the island, and back up
// after. Per app (its own volume in Windows' mixer), so nothing else changes:
//   duck <0..1>   each app's volume to that share of what it is now (faded over ~0.6 s)
//   unduck        back to what each had (faded); also run at start, in case the island quit mid-adhan
// What each app had is written to a small file first, so it's put back even after a restart.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

[ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISimpleAudioVolume {
  int SetMasterVolume(float level, ref Guid context);
  int GetMasterVolume(out float level);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

static class Duck {
  static readonly string FILE = Path.Combine(Path.GetTempPath(), "nova-island-duck.txt");
  static readonly object gate = new object();

  // the other apps' sessions on the default output: pid -> its volume control
  static List<KeyValuePair<uint, ISimpleAudioVolume>> Sessions() {
    var list = new List<KeyValuePair<uint, ISimpleAudioVolume>>();
    uint self = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
    try {
      var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      IMMDevice dev;
      Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
      Guid iid = typeof(IAudioSessionManager2).GUID;
      object o;
      Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, 0, out o));
      IAudioSessionEnumerator all;
      Marshal.ThrowExceptionForHR(((IAudioSessionManager2)o).GetSessionEnumerator(out all));
      int n;
      all.GetCount(out n);
      for (int i = 0; i < n; i++) {
        object s;
        if (all.GetSession(i, out s) != 0 || s == null) continue;
        var c = s as IAudioSessionControl2;
        uint pid;
        if (c == null || c.GetProcessId(out pid) != 0 || pid == 0 || pid == self) continue;
        // not the island's own sound (the adhan chime)
        try {
          using (var p = System.Diagnostics.Process.GetProcessById((int)pid)) {
            string name = p.ProcessName.ToLowerInvariant();
            if (name.StartsWith("nova island") || name == "electron") continue;
          }
        } catch { continue; }
        var v = s as ISimpleAudioVolume;
        if (v != null) list.Add(new KeyValuePair<uint, ISimpleAudioVolume>(pid, v));
      }
    } catch { }
    return list;
  }

  static void Fade(List<KeyValuePair<ISimpleAudioVolume, float[]>> moves) {
    Guid ctx = Guid.Empty;
    for (int step = 1; step <= 12; step++) {
      float t = step / 12f;
      t = t * t * (3 - 2 * t); // ease
      foreach (var m in moves) {
        try { m.Key.SetMasterVolume(m.Value[0] + (m.Value[1] - m.Value[0]) * t, ref ctx); } catch { }
      }
      Thread.Sleep(50);
    }
  }

  public static void Down(float share) {
    new Thread(() => {
      lock (gate) {
        // already down: keep the volumes saved the first time
        var saved = Load();
        var moves = new List<KeyValuePair<ISimpleAudioVolume, float[]>>();
        foreach (var s in Sessions()) {
          float v;
          if (s.Value.GetMasterVolume(out v) != 0) continue;
          float was;
          if (!saved.TryGetValue(s.Key, out was)) { was = v; saved[s.Key] = v; }
          moves.Add(new KeyValuePair<ISimpleAudioVolume, float[]>(s.Value, new[] { v, Math.Max(0, Math.Min(1, was * share)) }));
        }
        Save(saved);
        Fade(moves);
      }
    }) { IsBackground = true }.Start();
  }

  public static void Up() {
    new Thread(() => {
      lock (gate) {
        var saved = Load();
        if (saved.Count == 0) return;
        var moves = new List<KeyValuePair<ISimpleAudioVolume, float[]>>();
        foreach (var s in Sessions()) {
          float was, v;
          if (!saved.TryGetValue(s.Key, out was) || s.Value.GetMasterVolume(out v) != 0) continue;
          moves.Add(new KeyValuePair<ISimpleAudioVolume, float[]>(s.Value, new[] { v, was }));
        }
        Fade(moves);
        try { File.Delete(FILE); } catch { }
      }
    }) { IsBackground = true }.Start();
  }

  static Dictionary<uint, float> Load() {
    var d = new Dictionary<uint, float>();
    try {
      foreach (var line in File.ReadAllLines(FILE)) {
        var p = line.Split('=');
        uint pid; float v;
        if (p.Length == 2 && uint.TryParse(p[0], out pid) && float.TryParse(p[1], NumberStyles.Float, CultureInfo.InvariantCulture, out v)) d[pid] = v;
      }
    } catch { }
    return d;
  }
  static void Save(Dictionary<uint, float> d) {
    var lines = new List<string>();
    foreach (var kv in d) lines.Add(kv.Key + "=" + kv.Value.ToString(CultureInfo.InvariantCulture));
    try { File.WriteAllLines(FILE, lines); } catch { }
  }
}
