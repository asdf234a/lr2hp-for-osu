# LR2HP for osu
<img src="app/LR2HP/Assets/icon.png" width="96" alt="LR2HP for osu icon">

osu!lazer 매니아용 LR2 HP 게이지 [tosu](https://github.com/tosuapp/tosu) 오버레이입니다.
판정은 osu!에서 받아 LR2 게이지 규칙으로 다시 계산하고, 노트에 맞지 않은 키 입력은 공POOR로 처리합니다.

- EX-HARD / HARD / GROOVE / EASY 게이지를 동시에 계산하고 GAS(게이지 오토 시프트)로 표시합니다.
- 게이지 그림은 beatoraja `simple-play` 스킨의 `customize/gauge`(simple2 / simple / default)를 그대로 씁니다.
- **대시보드 오버레이**(`lr2hp-dashboard`): BMS 기준 랭크, EX 스코어, 스코어 레이트, 판정 카운트(FAST/SLOW 포함), MAX 콤보를 같은 스킨의 카운터·랭크 이미지로 보여줍니다.
- **공POOR 표시 오버레이**(`lr2hp-emptypoor`): 공POOR가 날 때마다 스킨의 POOR 판정 이미지(기본 Iridium의 MISS)를 beatoraja처럼 500ms 동안 띄웁니다.
- **LR2HP.exe**: 키 입력 헬퍼, osu! 키 설정 동기화, 클리어 램프 기록을 맡는 작은 앱입니다. 기록과 설정은 exe와 같은 폴더에만 저장합니다.
- 대상: osu!lazer, 1~7K. 키 설정 동기화는 stable도 지원합니다.

## 설치

1. `lr2hp`, `lr2hp-dashboard`, `lr2hp-emptypoor` 폴더를 tosu의 `static` 폴더에 복사합니다. 예: `tosu/static/lr2hp`
2. 공POOR 표시 오버레이를 쓰려면 판정 이미지를 가져옵니다. 여러 스킨에서 모은 이미지라 레포에는 들어 있지 않습니다.
   ```
   python tools/import_judges.py "<beatoraja>/skin/<simple-play>/customize/judge" "<tosu>/static/lr2hp-emptypoor/skins/judge"
   ```
3. `LR2HP.exe`를 원하는 폴더(예: `tosu/LR2HP/`)에 두고 실행합니다. .NET 10 런타임이 필요합니다.
4. tosu 대시보드(`http://127.0.0.1:24050`)에서 **LR2HP for osu**, **LR2HP for osu Dashboard**, **LR2HP for osu Empty POOR**를 찾아 설정합니다.
5. OBS 브라우저 소스 URL
   - 게이지: `http://127.0.0.1:24050/lr2hp/` (기본 크기 720x64. 폭은 게이지 길이 + 120px이며, 길이는 설정의 `Gauge length`로 바꿀 수 있습니다)
   - 대시보드: `http://127.0.0.1:24050/lr2hp-dashboard/` (230x260)
   - 공POOR 표시: `http://127.0.0.1:24050/lr2hp-emptypoor/` (Iridium 기준 76x32, 판정 이미지마다 다릅니다)

대시보드와 공POOR 표시 오버레이는 게이지 오버레이의 코드를 함께 쓰고, 키 배치와 공POOR 설정도 게이지 오버레이(**LR2HP for osu**) 쪽 설정을 그대로 읽습니다. 그래서 두 폴더를 나란히 설치해야 합니다.

osu! 자체 HP로 실패하면 플레이가 끝나므로 **NF(No Fail)** 를 켜고 플레이하는 것을 권장합니다.

## 판정 대응

| osu!mania | LR2 |
|---|---|
| 320 (MAX) | PGREAT |
| 300 | GREAT |
| 200, 100 | GOOD |
| 50 | BAD |
| 너무 일찍 눌러서 생긴 MISS (OD8 기준 127~164ms 이르게) | BAD (LR2라면 BAD 범위 안이라서. 설정으로 끌 수 있음) |
| 그 밖의 MISS (노트를 놓침) | POOR |
| 노트와 맞지 않은 키 입력 | 공POOR |

## 게이지 (LR2oraja 기준)

값은 LR2oraja Endless Dream 0.4.0의 LR2 게이지(`GaugeProperty.LR2`)와 같습니다. 순서: PG / GR / GD / BD / POOR / 공POOR.

| 게이지 | 시작 | 하한 | 클리어 | 증감 |
|---|---|---|---|---|
| EASY | 20% | 2% | 80% | TOTAL/N × (1.2, 1.2, 0.6), −3.2, −4.8, −1.6 |
| GROOVE | 20% | 2% | 80% | TOTAL/N × (1.0, 1.0, 0.5), −4, −6, −2 |
| HARD | 100% | 2% 미만이면 탈락 | 생존 | +0.1, +0.1, +0.05, −6, −10, −2 / 32% 미만 데미지 ×0.6 |
| EX-HARD | 100% | 2% 미만이면 탈락 | 생존 | +0.1, +0.1, +0.05, −12, −20, −2 |

- HARD / EX-HARD는 TOTAL이 240 미만이거나 노트 수가 1000 미만이면 데미지가 늘어납니다. 둘 중 큰 배율을 씁니다.
  - TOTAL 보정: `10 ÷ min(10, max(1, floor(TOTAL ÷ 16) − 5))`. 예: TOTAL 200이면 ×1.43, 160이면 ×2
  - 노트 수 보정: 1000노트 ×1, 500노트 ×2, 250노트 ×3, 125노트 ×4, 60노트 ×5, 30노트 ×8, 20노트 이하 ×10 (구간 사이는 직선)
- **TOTAL**은 osu! 채보에 없으므로 공식으로 정합니다. 기본값은 표준 공식 `7.605 × N / (0.01 × N + 6.5)`이고, 설정에서 LR2 기본값 / beatoraja / 직접 입력으로 바꿀 수 있습니다.
- **N(판정 수)**: 레이저는 롱노트의 머리와 꼬리를 따로 판정하므로 `노트 수 + 롱노트 수`입니다.

### GAS

설정한 **시작 게이지**부터 **바닥 게이지**까지 중에서 지금 조건을 만족하는 가장 높은 게이지를 표시합니다. HARD 계열은 살아있으면, GROOVE와 EASY는 80% 이상이면 조건을 만족합니다. 아무것도 만족하지 못하면 바닥 게이지를 표시합니다. 결과 화면에서는 클리어 램프(EX-HARD CLEAR / HARD CLEAR / CLEAR / EASY CLEAR / FAILED)를 보여줍니다.

## 공POOR

키를 눌렀는데 osu!가 그 입력을 노트에 쓰지 않았다면 공POOR입니다. 판별은 tosu가 보내주는 **hitErrors**를 기준으로 합니다. 레이저는 노트를 PERFECT~MEH로 판정하는 순간 그 오차값을 hitErrors에 추가합니다.

1. 키 입력 직후(60ms 안)에 hitErrors 항목이 새로 생기면 → **노트 입력으로 확정**합니다.
2. 항목이 생기지 않으면 → 이른 MISS이거나 공POOR입니다. 오버레이가 `.osu` 파일에서 해당 레인의 다음 노트를 찾습니다.
   - miss 판정 범위(`188 − 3·OD` ms 이전) 안이면 **이른 MISS**입니다. osu!가 노트를 MISS로 처리했으므로 POOR로 이미 반영됩니다.
   - 범위 밖이면 **공POOR**입니다.
3. 확정된 입력의 오차값으로 곡 시간 추정을 계속 **자동 보정**합니다. 따라서 2번의 판단도 1~2ms 정확도로 이루어집니다.

공POOR를 세는 범위는 설정의 **Empty POOR mode**로 정합니다.

- `lr2oraja` (기본): 그 레인의 다음 노트가 **1초 안에 다가올 때 미리 누른 입력만** 공POOR입니다. LR2oraja의 LR2 판정과 같은 규칙이라, 노트가 지나간 뒤 누르거나 근처에 노트가 없는 입력은 세지 않습니다.
- `near`: 다음 노트가 500ms 안에 있을 때만 셉니다.
- `all`: 채보가 진행되는 동안의 모든 헛누름을 셉니다. 설정의 **Show press stats**를 켜면 확정된 입력, 이른 MISS, 공POOR 개수와 시간 보정값(`sync`)이 표시됩니다.

키 입력은 다음 중 하나로 받습니다.

| 경우 | 입력 출처 |
|---|---|
| 1~4K | tosu만으로 동작 (`/websocket/v2/precise`의 키 카운터) |
| 5~7K | **LR2HP.exe 필요** |

tosu API는 키 카운터를 4개(`k1, k2, m1, m2`)까지만 내보내기 때문에 5K 이상은 tosu만으로는 알 수 없습니다. LR2HP.exe가 켜져 있으면 키 수와 상관없이 그 입력을 우선 사용합니다. 입력을 레인에 맞추는 키 배치는 LR2HP.exe가 osu! 설정에서 그대로 가져옵니다. 노트 입력은 hitErrors로 확정되므로 레인 배치가 틀려도 영향이 적지만, 공POOR와 이른 MISS 구분에는 레인이 쓰입니다.

## LR2HP.exe

[Lazer Replay Compare](https://github.com/asdf234a/LazerReplayCompare)의 compact 창과 같은 모양의 작은 앱입니다(Avalonia, .NET 10, 단일 exe). 항상 위에 떠 있고, 창 아무 곳이나 끌어서 옮깁니다.

- **키 입력 헬퍼**: `GetAsyncKeyState`로 키보드 상태를 1ms마다 읽어 osu! 창이 포커스일 때만 `ws://127.0.0.1:24055`로 오버레이에 보냅니다. 키 뷰어 프로그램과 같은 방식이라 osu! 프로세스의 메모리를 읽거나 쓰지 않고, DLL 주입이나 입력 전송도 하지 않습니다.
- **키 설정 동기화 (lazer / stable)**: 켤 때, tosu가 다른 클라이언트에 붙을 때, ↻ 버튼을 누를 때 osu!의 매니아 키 설정을 읽어 오버레이에 보냅니다.
  - lazer: 데이터 폴더의 `client.realm`을 레이저와 같은 Realm(20.1.0)으로 읽습니다. 게임이 쓰는 원본은 열지 않고 임시 복사본을 읽은 뒤 지웁니다.
  - stable: 게임 폴더의 `osu!.<Windows 사용자 이름>.cfg`에서 `ManiaLayoutsNK` 줄을 읽습니다.
  - 폴더는 tosu가 알려주는 경로(lazer는 `folders.songs`의 상위, stable은 `folders.game`)를 먼저 쓰고, 그 밖에는 `%APPDATA%\osu\storage.ini`와 레지스트리의 osu! 경로에서 찾습니다.
  - 오버레이는 지금 플레이 중인 클라이언트의 배치를 씁니다. 동기화된 배치가 없는 키 수는 설정의 키 배치(`7K keys` 등)를 쓰고, **Key layout source**를 `manual`로 바꾸면 항상 설정의 키 배치를 씁니다.
- **클리어 램프 기록**: 게이지 오버레이가 결과 화면에서 클리어(GAS 범위 안에서 조건을 만족한 가장 높은 게이지)를 보내면, **맵(난이도 MD5) + 배속**별로 저장합니다. 기록에는 램프(EASY / CLEAR / HARD / EX-HARD), TOTAL 옵션과 값(standard / lr2 / beatoraja / custom), EX 스코어, 판정 수, 공POOR, 게이지별 최종값, 날짜가 들어갑니다.
- **화면**: 연결 상태(tosu, 오버레이), 선택된 곡, 지금 배속의 기록 카드, 다른 배속의 램프, 쓰고 있는 키 배치를 보여줍니다. 기록 카드는 이렇게 생겼습니다.
  - 왼쪽: 클리어 램프 바(EASY 초록, CLEAR 파랑, HARD 빨강, EX-HARD 노랑). 은은하게 깜빡이고, EX-HARD는 빠르게 깜빡입니다.
  - 가운데: 램프 이름, 그리고 그 배속의 최고 EX 스코어, 스코어 레이트, 최저 BP(BAD + POOR + 공POOR)
  - 오른쪽: BMS 랭크(AAA / AA / A …)와 가까운 랭크 경계까지의 점수. 예: `AAA-0006`(AAA까지 6점), `AA+0012`(AA보다 12점 위), `MAX-0004`(만점까지 4점)

### 저장 파일 (exe와 같은 폴더)

| 파일 | 내용 |
|---|---|
| `clears.json` | 클리어 기록 |
| `keybinds.json` | 마지막으로 읽은 lazer / stable 키 배치 |
| `settings.json` | 포트(24055), tosu 주소, 대상 프로세스 이름(`osu!`), 테마(`Dark` / `Light` / `System`), 창 위치 |

폴더째 옮기거나 복사해도 기록이 그대로 따라갑니다.

### 빌드

```
dotnet publish app/LR2HP -c Release -o app/publish
```

## 한계

- 변환(convert) 채보는 노트 배치를 알 수 없어서 공POOR를 세지 않습니다. 노트 수는 tosu의 rosu-pp 계산으로 얻습니다.
- 한 번의 tosu 업데이트(기본 150ms) 안에 들어온 여러 판정은 실제 순서를 알 수 없어서 종류별로 번갈아 적용합니다. tosu 설정에서 `POLL_RATE`를 100으로 낮추면 더 정확해집니다.
- 곡 시간 보정은 노트를 몇 개 친 뒤부터 적용됩니다. 곡 시작 직후의 헛누름은 보정 전 추정(±20ms)으로 판단합니다.
- tosu의 hitErrors에 레이저 롱노트 끝 판정이 섞여 들어오는 경우가 있을 수 있는데, 노트 머리 위치와 맞지 않는 항목은 보정에 쓰지 않습니다.
- RD(랜덤) 같은 레인 셔플 모드에서는 레인을 구분하지 않고 매칭합니다.

## 대시보드 (BMS 기준)

| 항목 | 계산 |
|---|---|
| EX SCORE | PGREAT × 2 + GREAT |
| RATE | EX SCORE ÷ (지금까지 판정된 노트 수 × 2) |
| 랭크 | RATE 기준. AAA 8/9 이상, AA 7/9, A 6/9, B 5/9, C 4/9, D 3/9, E 2/9, 그 아래 F |
| PG / GR / GD / BD / PR | 판정 대응표와 같습니다 |
| KP | 공POOR |
| CB | 콤보 브레이크 = BAD + POOR |
| MAX.C | BMS 콤보. PG/GR/GD는 이어지고 BAD/POOR에서 끊기며, 공POOR는 영향이 없습니다 |

FAST/SLOW는 이렇게 셉니다.

- PG~BD: osu!가 보낸 hitErrors 오차값의 부호로 나눕니다. 판정 칸은 레이저 매니아 판정 범위로 나눕니다(OD 기준, HR/EZ 반영). 경계에 걸린 몇 개는 합계 칸과 1~2개 차이가 날 수 있습니다.
- PR: 이른 MISS는 FAST, 노트를 놓친 MISS는 SLOW입니다.
- KP: 다음 노트에 더 가까운 헛누름은 FAST, 이전 노트에 더 가까운 헛누름은 SLOW입니다.

이미지는 beatoraja simple-play의 `customize/counter`(default / default_old)와 `customize/rank`(noto 기본, default, default_s, default2, block, neonew, KCOOL)를 씁니다.

## 미리보기 / 테스트

- `lr2hp/index.html?demo=1`, `lr2hp-dashboard/index.html?demo=1`: tosu 없이 가짜 플레이로 화면을 확인합니다. URL 파라미터로 설정을 덮어쓸 수 있습니다. 예: `?demo=1&startGauge=HARD&parts=60`
- `npm test`: 게이지 계산, `.osu` 파싱, 입력 판별, 점수/랭크 단위 테스트
- `?debug`: 브라우저 콘솔에서 `lr2hp.classifier.log`로 최근 입력 판별 기록을 볼 수 있습니다.

## 크레딧

게이지 / 숫자 / 카운터 / 랭크 이미지: beatoraja 스킨 *simple-play* (mnpy). 스킨 readme에 따라 자유롭게 이용·수정·재배포할 수 있습니다.
