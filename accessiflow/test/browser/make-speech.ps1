# Makes the speech clips for the caption check with the SAPI voices built into
# Windows: 48 kHz stereo, the format a captured Chrome tab usually has, so the
# check also exercises the resampler rather than handing Whisper ready-made
# 16 kHz audio.
param([Parameter(Mandatory = $true)][string]$Out)
Add-Type -AssemblyName System.Speech
$expected = Get-Content -Raw (Join-Path $PSScriptRoot 'expected.json') | ConvertFrom-Json
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Stereo)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = @($synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name })
$synth.Dispose()
$i = 0
foreach ($clip in $expected.PSObject.Properties) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  # Alternate voices, so the check is not tuned to one speaker.
  $s.SelectVoice($voices[$i % $voices.Count]); $i++
  $s.SetOutputToWaveFile((Join-Path $Out ($clip.Name + '.wav')), $format)
  $s.Speak($clip.Value)
  $s.Dispose()
}
