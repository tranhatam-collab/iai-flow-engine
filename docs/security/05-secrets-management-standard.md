# Secrets Management Standard

## Mục tiêu

Secrets là phần nhạy cảm nhất trong hệ thống. Mọi API key, token, credential hoặc signing material phải được quản lý theo nguyên tắc tối thiểu quyền và không lộ plaintext.

## Khái niệm

Secret là:
- API key
- access token
- refresh token
- service credential
- database credential
- webhook signing secret
- encryption-related material

## Nguyên tắc

1. Secrets thuộc workspace
2. Secrets được mã hóa khi lưu
3. Không hiển thị lại plaintext sau khi lưu
4. Không log plaintext
5. Secret usage phải audit được
6. Secret rotation phải hỗ trợ được

## Cấu trúc dữ liệu tối thiểu

- secret_id
- workspace_id
- name
- type
- ciphertext
- key_version
- created_by
- created_at
- rotated_at
- last_used_at
- status
- access_scope

## Secret access scope

Ví dụ:
- chỉ node loại API mới được dùng
- chỉ workflows được gắn scope mới được gọi
- chỉ runtime service mới được resolve plaintext
- UI chỉ xem metadata

## UI policy

UI chỉ được hiển thị:
- tên secret
- loại secret
- created_at
- rotated_at
- masked preview nếu cần

UI không được:
- hiển thị lại full value
- trả plaintext qua API read thông thường

## Rotation policy

Phải hỗ trợ:
- rotate secret tạo version mới
- mark old version deprecated
- cho phép grace period nếu cần
- audit full event

## Logging policy

Không bao giờ log:
- plaintext secret
- Authorization header đầy đủ
- full webhook secret
- private key material

Được phép log:
- secret_id
- masked preview
- secret type
- workspace_id
- action metadata

## Access policy

- owner/admin mới được quản secret mặc định
- builder/operator chỉ dùng secret theo scope, không quản trị secret
- secret use là capability riêng

## Điều cấm

- không để secret trong workflow JSON plaintext
- không cho export secrets
- không trả secret qua client debug endpoints
- không copy secret vào audit metadata
