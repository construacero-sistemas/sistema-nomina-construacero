# scripts/transcribir_audio.py
# Transcripción LOCAL de audios (no sale de tu PC) con faster-whisper.
#
# Uso:
#   python scripts/transcribir_audio.py "ruta/audio.ogg"          # transcribe y imprime
#   python scripts/transcribir_audio.py audio1.ogg audio2.ogg ... # varios archivos
#
# El primer uso descarga el modelo (~460 MB, una sola vez). Después es instantáneo.
import sys

def main():
    rutas = [a for a in sys.argv[1:] if not a.startswith('-')]
    if not rutas:
        print('uso: python scripts/transcribir_audio.py <audio.ogg> [audio2.ogg ...]')
        sys.exit(1)

    from faster_whisper import WhisperModel

    # "small": buen equilibrio calidad/velocidad para español en CPU.
    modelo = WhisperModel('small', device='cpu', compute_type='int8')

    for ruta in rutas:
        print(f'--- {ruta}')
        segmentos, info = modelo.transcribe(ruta, language='es', vad_filter=True)
        texto = ' '.join(s.text.strip() for s in segmentos).strip()
        print(texto if texto else '(sin voz detectada)')
        print()

if __name__ == '__main__':
    main()
