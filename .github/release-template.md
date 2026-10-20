## 설치 방법

1. 아래 두 파일을 받습니다.
   - `lr2hp-for-osu-overlays-{version}.zip`: tosu 오버레이 3개 (게이지, 대시보드, 공POOR 표시)
   - `lr2hp-for-osu-app-{version}.zip`: `lr2hp-for-osu.exe`와 기본 `settings.json`, `keybinds.json` ([.NET 10 데스크톱 런타임](https://dotnet.microsoft.com/download/dotnet/10.0) 필요)
2. 오버레이 압축을 풀어 나온 세 폴더(`lr2hp-for-osu`, `lr2hp-for-osu-dashboard`, `lr2hp-for-osu-emptypoor`)를 tosu의 `static` 폴더에 넣습니다. 세 폴더는 나란히 있어야 합니다.
3. 앱 압축을 풀면 나오는 `lr2hp-for-osu` 폴더를 통째로 원하는 곳(예: `tosu/lr2hp-for-osu/`)에 두고 `lr2hp-for-osu.exe`를 실행합니다. 기록과 설정은 exe와 같은 폴더에, 백업은 `backup` 폴더에, 로그는 `logs` 폴더에 저장됩니다.
4. tosu 대시보드(`http://127.0.0.1:24050`)에서 **lr2hp-for-osu**, **lr2hp-for-osu Dashboard**, **lr2hp-for-osu Empty POOR**를 설정합니다.
5. OBS 브라우저 소스 URL
   - 게이지: `http://127.0.0.1:24050/lr2hp-for-osu/`
   - 대시보드: `http://127.0.0.1:24050/lr2hp-for-osu-dashboard/`
   - 공POOR 표시: `http://127.0.0.1:24050/lr2hp-for-osu-emptypoor/`

이전 버전에서 올릴 때는 앱 폴더의 `lr2hp-for-osu.exe`와 오버레이 세 폴더를 바꾸면 됩니다. 앱 zip의 json까지 덮어쓰면 설정이 기본값으로 돌아가니 exe만 바꾸세요. 기록(`clears.json`)은 zip에 들어 있지 않아 그대로 유지됩니다. 공POOR 판정 이미지를 직접 넣었다면 `lr2hp-for-osu-emptypoor/skins/judge` 폴더는 덮어쓰기 전에 백업하세요.

설정 설명과 커스텀 스킨 적용법은 [README](https://github.com/asdf234a/lr2hp-for-osu#readme)를 보세요.
