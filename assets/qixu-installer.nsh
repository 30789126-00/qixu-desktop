!macro customInit
  ; Existing F: drive installations continue to upgrade in place.
  ; Fresh public installs use electron-builder's per-user default directory.
  IfFileExists "F:\栖序\栖序.exe" 0 +2
    StrCpy $INSTDIR "F:\栖序"
!macroend
