// The parts of "Battery saver now" that only Windows' own APIs can switch (nova.js keeps the
// user's values and puts them back):
//   fxget        -> {"fx":{"hz":120,"anim":1,"transp":1}}
//   hz <n>       the main display's refresh rate to n Hz at its current resolution, for this session
//                only (a restart or "hz 0" brings back the one in Windows' settings)
//   anim <0|1>   window animations (open/close, minimize/maximize), like Settings > Animation effects
//   transp <0|1> transparency effects (taskbar, Start), like Settings > Transparency effects
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32;

static class Saver {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
    public int dmFields;
    public int dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels;
    public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
    public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
  }
  [StructLayout(LayoutKind.Sequential)] struct ANIMATIONINFO { public int cbSize, iMinAnimate; }

  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettings(string dev, int mode, ref DEVMODE dm);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string dev, ref DEVMODE dm, IntPtr hwnd, int flags, IntPtr param);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string dev, IntPtr dm, IntPtr hwnd, int flags, IntPtr param);
  [DllImport("user32.dll")] static extern bool SystemParametersInfo(int action, int param, ref bool value, int ini);
  [DllImport("user32.dll")] static extern bool SystemParametersInfo(int action, int param, IntPtr value, int ini);
  [DllImport("user32.dll")] static extern bool SystemParametersInfo(int action, int param, ref ANIMATIONINFO value, int ini);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr h, int msg, IntPtr w, string l, int flags, int timeout, out IntPtr result);

  const int ENUM_CURRENT = -1, DM_DISPLAYFREQUENCY = 0x400000;
  const int SPI_GETANIMATION = 0x48, SPI_SETANIMATION = 0x49, SPI_GETCLIENTAREAANIMATION = 0x1042, SPI_SETCLIENTAREAANIMATION = 0x1043;
  const int SPIF_SAVE = 0x3; // write it to the user's settings and tell running apps
  const string PERSONALIZE = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

  static DEVMODE Current() {
    var dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
    EnumDisplaySettings(null, ENUM_CURRENT, ref dm);
    return dm;
  }

  public static string Get() {
    bool client = true;
    SystemParametersInfo(SPI_GETCLIENTAREAANIMATION, 0, ref client, 0);
    int transp = 1;
    try { using (var k = Registry.CurrentUser.OpenSubKey(PERSONALIZE)) transp = Convert.ToInt32(k.GetValue("EnableTransparency", 1)); } catch { }
    return "{\"fx\":{\"hz\":" + Current().dmDisplayFrequency + ",\"anim\":" + (client ? 1 : 0) + ",\"transp\":" + transp + "}}";
  }

  public static void Hz(int hz) {
    if (hz <= 0) { ChangeDisplaySettingsEx(null, IntPtr.Zero, IntPtr.Zero, 0, IntPtr.Zero); return; } // back to Windows' setting
    var cur = Current();
    if (cur.dmDisplayFrequency == hz) return;
    // only a mode the display really has, at the resolution it's at now
    var dm = new DEVMODE(); dm.dmSize = cur.dmSize;
    for (int i = 0; EnumDisplaySettings(null, i, ref dm); i++) {
      if (dm.dmPelsWidth == cur.dmPelsWidth && dm.dmPelsHeight == cur.dmPelsHeight && dm.dmBitsPerPel == cur.dmBitsPerPel && dm.dmDisplayFrequency == hz) {
        cur.dmDisplayFrequency = hz;
        cur.dmFields = DM_DISPLAYFREQUENCY;
        ChangeDisplaySettingsEx(null, ref cur, IntPtr.Zero, 0, IntPtr.Zero); // 0: this session only, not saved
        return;
      }
    }
  }

  public static void Anim(bool on) {
    SystemParametersInfo(SPI_SETCLIENTAREAANIMATION, 0, on ? (IntPtr)1 : IntPtr.Zero, SPIF_SAVE);
    var ai = new ANIMATIONINFO { cbSize = Marshal.SizeOf(typeof(ANIMATIONINFO)), iMinAnimate = on ? 1 : 0 };
    SystemParametersInfo(SPI_SETANIMATION, ai.cbSize, ref ai, SPIF_SAVE);
  }

  public static void Transp(bool on) {
    try { using (var k = Registry.CurrentUser.CreateSubKey(PERSONALIZE)) k.SetValue("EnableTransparency", on ? 1 : 0, RegistryValueKind.DWord); } catch { return; }
    IntPtr r;
    SendMessageTimeout((IntPtr)0xffff, 0x1A, IntPtr.Zero, "ImmersiveColorSet", 0x2, 1000, out r); // tell the taskbar and Start
  }
}
