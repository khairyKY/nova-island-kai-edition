// Browser native messaging runs separately from the media/window helper. No UI Automation.
using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.RegularExpressions;
static class BrowserMediaHost {
  static bool Read(Stream input, byte[] bytes) {
    int n = 0, got;
    while (n < bytes.Length && (got = input.Read(bytes, n, bytes.Length - n)) > 0) n += got;
    return n == bytes.Length;
  }
  static int Main() {
    var input = Console.OpenStandardInput(); var output = Console.OpenStandardOutput();
    try {
      var header = new byte[4];
      while (Read(input, header)) {
        int count = BitConverter.ToInt32(header, 0);
        if (count < 2 || count > 60000) return 1;
        var data = new byte[count]; if (!Read(input, data)) return 1;
        bool connected = false;
        try {
          string local = Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
          string endpoint = File.ReadAllText(Path.Combine(local, "NovaIslandBrowser", "endpoint"));
          if (Regex.IsMatch(endpoint, "^[a-f0-9]{96}$")) {
            using (var pipe = new NamedPipeClientStream(".", "nova-browser-media-" + endpoint.Substring(0, 48), PipeDirection.Out)) {
              pipe.Connect(300);
              byte[] message = Encoding.UTF8.GetBytes("{\"token\":\"" + endpoint.Substring(48) + "\",\"snapshot\":" + Encoding.UTF8.GetString(data) + "}");
              pipe.Write(message, 0, message.Length);
              connected = true;
            }
          }
        } catch { }
        byte[] reply = Encoding.UTF8.GetBytes(connected ? "{\"connected\":true}" : "{\"connected\":false}");
        byte[] size = BitConverter.GetBytes(reply.Length); output.Write(size, 0, 4); output.Write(reply, 0, reply.Length); output.Flush();
      }
    } catch { return 1; }
    return 0;
  }
}
