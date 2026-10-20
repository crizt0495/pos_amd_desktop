; Skrip NSIS tambahan untuk KasirPro POS.
; Tujuan: sebelum install, coba hapus otomatis instalasi lama (KasirPro POS
; versi per-user / "Bagas POS") agar tidak menumpuk.
!macro customInit
  ; Buat folder data di AppData otomatis (supaya DB & lisensi tidak di Program Files).
  CreateDirectory "$APPDATA\\KasirPro POS"
  ; Hapus instalasi lama KasirPro POS (per-user, versi lama perMachine=false)
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\app.kasirpro.pos" "UninstallString"
  ${If} $0 != ""
    ExecWait '"$0" /S' $1
  ${EndIf}
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\KasirPro POS" "UninstallString"
  ${If} $0 != ""
    ExecWait '"$0" /S' $1
  ${EndIf}
  ; Hapus instalasi lama "Bagas POS" (jika ada) dari per-user & per-machine
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Bagas POS" "UninstallString"
  ${If} $0 != ""
    ExecWait '"$0" /S' $1
  ${EndIf}
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Bagas POS" "UninstallString"
  ${If} $0 != ""
    ExecWait '"$0" /S' $1
  ${EndIf}
!macroend