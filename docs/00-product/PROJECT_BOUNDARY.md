# Project Boundary

## Current Development Repository

`D:\Ai\staking-wallet-web`

관리형 Staking Wallet Web App의 실제 개발 저장소다.

## Legacy Repository

`D:\Ai\Staking-Wallet`

기존 Solana Wallet Adapter dApp과 Expo Self-Custody Wallet을 보존하는 참고 저장소다.

## New Product Rules

- 이메일·비밀번호 기반 사용자 인증
- Supabase Auth
- PostgreSQL
- Row-Level Security
- 내부 복식 원장
- 관리자 승인과 불변 감사
- Browser·App 개인키 없음
- 금융 상태를 localStorage에 저장하지 않음
- Client 거래 서명·전송 없음
- LOCAL·PREVIEW에서 Mainnet 사용 금지
- 실제 온체인 기능은 별도 미래 Phase

## Prohibited Legacy Reuse

신규 프로젝트는 Legacy 저장소의 다음 기능을 직접 Import하거나 복사하지 않는다.

- Wallet Adapter
- Phantom 연결
- Wallet 주소 기반 사용자 인증
- 니모닉·개인키
- SecureStore Wallet
- Client 거래 서명
- Client SOL 전송
- Mainnet 기본 RPC
- localStorage 금융 상태

순수 Validation·Formatting 로직은 별도 검토와 테스트 후 신규 프로젝트 기준으로 재작성할 수 있다.
