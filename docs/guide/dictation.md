English · [Português](../pt-BR/guia/ditado.md)

# Dictation

`⌃⇧D` (or the microphone button) records and transcribes offline with `whisper.cpp`. Install `ffmpeg` and `whisper-cpp` with Homebrew and download a model; Kabul finds it in the usual cache folders. The text is inserted where the cursor is.

On Windows, install `ffmpeg` (`winget install Gyan.FFmpeg`) and put `whisper-cli.exe` on the `PATH` (or set `KABUL_BIN_WHISPER_CLI`). On the phone, dictation uses the microphone through the browser and needs HTTPS (see [Cloud and mobile](./cloud-and-mobile.md)).
