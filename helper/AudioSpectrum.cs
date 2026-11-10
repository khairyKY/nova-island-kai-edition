using System;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

[ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ILoopbackAudioClient {
  [PreserveSig] int Initialize(int shareMode, uint flags, long bufferDuration, long periodicity, IntPtr format, IntPtr session);
  [PreserveSig] int GetBufferSize(out uint frames);
  [PreserveSig] int GetStreamLatency(out long latency);
  [PreserveSig] int GetCurrentPadding(out uint frames);
  [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
  [PreserveSig] int GetMixFormat(out IntPtr format);
  [PreserveSig] int GetDevicePeriod(out long normal, out long minimum);
  [PreserveSig] int Start();
  [PreserveSig] int Stop();
  [PreserveSig] int Reset();
  [PreserveSig] int SetEventHandle(IntPtr handle);
  [PreserveSig] int GetService(ref Guid id, [MarshalAs(UnmanagedType.IUnknown)] out object service);
}

[ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ILoopbackCaptureClient {
  [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong position, out ulong timestamp);
  [PreserveSig] int ReleaseBuffer(uint frames);
  [PreserveSig] int GetNextPacketSize(out uint frames);
}

// A Hann window and a reused FFT workspace keep the display responsive without allocation per sample.
sealed class BandSpectrum {
  public const int WindowSize = 2048, Hop = 1024; // 50% overlap: ~47 analyses/s at 48 kHz
  public static readonly int[] Edges = { 45, 180, 500, 1500, 4500, 12000 };
  readonly double[] window = new double[WindowSize];
  readonly double[] real = new double[WindowSize], imaginary = new double[WindowSize];
  readonly double[] cos = new double[WindowSize / 2], sin = new double[WindowSize / 2];
  readonly int[] reversed = new int[WindowSize];
  readonly double[] samples = new double[WindowSize]; // ring of the latest WindowSize samples
  readonly int sampleRate;
  int write, filled, sinceLast;
  public int Version { get; private set; }
  public readonly double[] Levels = new double[5];

  public BandSpectrum(int sampleRate) {
    this.sampleRate = sampleRate;
    for (int i = 0, j = 0; i < WindowSize; i++) {
      window[i] = .5 - .5 * Math.Cos(2 * Math.PI * i / (WindowSize - 1));
      reversed[i] = j;
      for (int bit = WindowSize / 2; bit > 0; bit /= 2) {
        j ^= bit;
        if ((j & bit) != 0) break;
      }
    }
    for (int i = 0; i < cos.Length; i++) {
      double angle = -2 * Math.PI * i / WindowSize;
      cos[i] = Math.Cos(angle);
      sin[i] = Math.Sin(angle);
    }
  }

  public void Add(double value) {
    samples[write] = value;
    write = (write + 1) & (WindowSize - 1);
    if (filled < WindowSize) filled++;
    if (++sinceLast < Hop || filled < WindowSize) return;
    sinceLast = 0;
    for (int i = 0; i < WindowSize; i++) {
      int index = reversed[i];
      real[index] = samples[(write + i) & (WindowSize - 1)] * window[i];
      imaginary[index] = 0;
    }
    Transform();
    Version++;
  }

  void Transform() {
    for (int size = 2; size <= WindowSize; size *= 2) {
      int half = size / 2, step = WindowSize / size;
      for (int start = 0; start < WindowSize; start += size) {
        for (int i = 0; i < half; i++) {
          int a = start + i, b = a + half, twiddle = i * step;
          double r = real[b] * cos[twiddle] - imaginary[b] * sin[twiddle];
          double q = real[b] * sin[twiddle] + imaginary[b] * cos[twiddle];
          real[b] = real[a] - r;
          imaginary[b] = imaginary[a] - q;
          real[a] += r;
          imaginary[a] += q;
        }
      }
    }
    for (int band = 0; band < Levels.Length; band++) {
      int first = Math.Max(1, (int)Math.Ceiling(Edges[band] * (double)WindowSize / sampleRate));
      int end = Math.Min(WindowSize / 2, (int)Math.Ceiling(Edges[band + 1] * (double)WindowSize / sampleRate));
      double power = 0;
      for (int bin = first; bin < end; bin++) power += real[bin] * real[bin] + imaginary[bin] * imaginary[bin];
      double amplitude = 4.0 * Math.Sqrt(power) / WindowSize;
      double db = 20 * Math.Log10(Math.Max(1e-8, amplitude));
      Levels[band] = Math.Pow(Math.Max(0, Math.Min(1, (db + 70) / 70)), 1.35);
    }
  }
}

sealed class PlaybackLoopback : IDisposable {
  const uint Loopback = 0x20000, EventCallback = 0x40000, Silent = 2;
  static readonly Guid FloatFormat = new Guid("00000003-0000-0010-8000-00AA00389B71");
  static readonly Guid PcmFormat = new Guid("00000001-0000-0010-8000-00AA00389B71");
  ILoopbackAudioClient client;
  ILoopbackCaptureClient capture;
  byte[] packet = new byte[0];
  int channels, blockSize, sampleBytes;
  bool floating;
  public int SampleRate { get; private set; }
  public readonly AutoResetEvent Ready = new AutoResetEvent(false);

  public PlaybackLoopback() {
    IntPtr format = IntPtr.Zero;
    try {
      client = Audio.Endpoint<ILoopbackAudioClient>();
      Marshal.ThrowExceptionForHR(client.GetMixFormat(out format));
      int tag = Marshal.ReadInt16(format, 0) & 0xffff;
      channels = Marshal.ReadInt16(format, 2);
      SampleRate = Marshal.ReadInt32(format, 4);
      blockSize = Marshal.ReadInt16(format, 12);
      sampleBytes = Marshal.ReadInt16(format, 14) / 8;
      Guid subtype = tag == 0xfffe && Marshal.ReadInt16(format, 16) >= 22
        ? (Guid)Marshal.PtrToStructure(IntPtr.Add(format, 24), typeof(Guid))
        : tag == 3 ? FloatFormat : tag == 1 ? PcmFormat : Guid.Empty;
      floating = subtype == FloatFormat;
      if (channels < 1 || channels > 32 || SampleRate <= 0 || blockSize < channels * sampleBytes ||
          (floating ? sampleBytes != 4 : subtype != PcmFormat || sampleBytes < 1 || sampleBytes > 4)) {
        throw new NotSupportedException("Unsupported playback mix format");
      }
      Marshal.ThrowExceptionForHR(client.Initialize(0, Loopback | EventCallback, 0, 0, format, IntPtr.Zero));
      Marshal.ThrowExceptionForHR(client.SetEventHandle(Ready.SafeWaitHandle.DangerousGetHandle()));
      Guid captureId = typeof(ILoopbackCaptureClient).GUID;
      object service;
      Marshal.ThrowExceptionForHR(client.GetService(ref captureId, out service));
      capture = (ILoopbackCaptureClient)service;
      Marshal.ThrowExceptionForHR(client.Start());
    } catch { Dispose(); throw; }
    finally { if (format != IntPtr.Zero) Marshal.FreeCoTaskMem(format); }
  }

  public bool Read(BandSpectrum spectrum) {
    bool received = false;
    uint available;
    Marshal.ThrowExceptionForHR(capture.GetNextPacketSize(out available));
    while (available > 0) {
      IntPtr data;
      uint frames, flags;
      ulong position, timestamp;
      Marshal.ThrowExceptionForHR(capture.GetBuffer(out data, out frames, out flags, out position, out timestamp));
      if (frames == 0) break;
      try {
        if ((flags & Silent) != 0) {
          for (uint i = 0; i < frames; i++) spectrum.Add(0);
        } else {
          int size = checked((int)frames * blockSize);
          if (packet.Length < size) packet = new byte[size];
          Marshal.Copy(data, packet, 0, size);
          for (int offset = 0; offset < size; offset += blockSize) {
            double sum = 0;
            for (int ch = 0; ch < channels; ch++) sum += Sample(offset + ch * sampleBytes);
            spectrum.Add(sum / channels);
          }
        }
        received = true;
      } finally { Marshal.ThrowExceptionForHR(capture.ReleaseBuffer(frames)); }
      Marshal.ThrowExceptionForHR(capture.GetNextPacketSize(out available));
    }
    return received;
  }

  double Sample(int offset) {
    if (floating) return BitConverter.ToSingle(packet, offset);
    switch (sampleBytes) {
      case 1: return (packet[offset] - 128) / 128.0;
      case 2: return BitConverter.ToInt16(packet, offset) / 32768.0;
      case 3:
        int pcm = packet[offset] | (packet[offset + 1] << 8) | (packet[offset + 2] << 16);
        return ((pcm << 8) >> 8) / 8388608.0;
      default: return BitConverter.ToInt32(packet, offset) / 2147483648.0;
    }
  }

  public void Dispose() {
    if (client != null) client.Stop();
    if (capture != null) Marshal.ReleaseComObject(capture);
    if (client != null) Marshal.ReleaseComObject(client);
    Ready.Dispose();
    capture = null;
    client = null;
  }
}

// Audio stays on the helper thread. Only five normalized levels cross into the app.
static class AudioBands {
  static readonly AutoResetEvent changed = new AutoResetEvent(false);
  static volatile bool enabled;
  static int generation;
  const string Silence = "{\"audioBands\":[0,0,0,0,0]}";

  public static void SetEnabled(bool on) {
    if (on == enabled) return;
    enabled = on;
    Interlocked.Increment(ref generation);
    changed.Set();
  }

  public static void Start(TextWriter output) {
    var thread = new Thread(() => Watch(output)) { IsBackground = true };
    thread.SetApartmentState(ApartmentState.MTA);
    thread.Start();
  }

  static void Watch(TextWriter output) {
    while (true) {
      if (!enabled) { changed.WaitOne(); continue; }
      int version = Thread.VolatileRead(ref generation);
      try {
        string device = Audio.OutputId();
        using (var loopback = new PlaybackLoopback()) {
          var spectrum = new BandSpectrum(loopback.SampleRate);
          var events = new WaitHandle[] { changed, loopback.Ready };
          var lastPacket = DateTime.UtcNow;
          var checkDevice = lastPacket.AddSeconds(2);
          string last = Silence;
          var sent = new double[5]; // levels of the last emitted line
          var lastEmit = DateTime.MinValue;
          bool pending = false;
          if (enabled) output.WriteLine(last);
          while (enabled && version == Thread.VolatileRead(ref generation)) {
            int frame = spectrum.Version;
            bool received = loopback.Read(spectrum);
            var now = DateTime.UtcNow;
            if (received) lastPacket = now;
            if (spectrum.Version != frame) pending = true;
            string line = last;
            // at most ~30 lines/s; a rate-limited frame is sent on a later wake, not dropped
            if (pending && now - lastEmit >= TimeSpan.FromMilliseconds(33)) {
              pending = false;
              bool moved = last == Silence;
              for (int i = 0; i < sent.Length; i++) if (Math.Abs(spectrum.Levels[i] - sent[i]) > .01) moved = true;
              if (moved) {
                Array.Copy(spectrum.Levels, sent, sent.Length);
                var numbers = Array.ConvertAll(spectrum.Levels, level => level.ToString("0.000", CultureInfo.InvariantCulture));
                line = "{\"audioBands\":[" + string.Join(",", numbers) + "]}";
              }
            } else if (!pending && now - lastPacket > TimeSpan.FromMilliseconds(120)) line = Silence;
            if (line != last && enabled && version == Thread.VolatileRead(ref generation)) {
              output.WriteLine(line);
              last = line;
              lastEmit = now;
            }
            if (now >= checkDevice) {
              if (Audio.OutputId() != device) break;
              checkDevice = now.AddSeconds(2);
            }
            WaitHandle.WaitAny(events, 120);
          }
        }
      } catch (IOException) { return; }
      catch {
        if (enabled) output.WriteLine(Silence);
        changed.WaitOne(750);
      }
    }
  }
}
