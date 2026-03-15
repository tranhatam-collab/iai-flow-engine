# Session Security Standard

## Mục tiêu

Session là nền của mọi truy cập đã xác thực. Nếu session không an toàn, toàn bộ identity và permission đều mất giá trị.

## Yêu cầu bắt buộc

- session server-side authoritative
- cookie HttpOnly
- cookie Secure
- SameSite=Lax hoặc Strict tùy khu vực
- expiry rõ ràng
- revoke được
- rotate được

## Cấu trúc session tối thiểu

- session_id
- user_id
- created_at
- expires_at
- revoked_at
- last_seen_at
- ip_hash
- user_agent_hash
- risk_level

## Vòng đời session

### Login
- xác minh danh tính
- tạo session mới
- rotate token
- audit success/failure

### Active use
- cập nhật last_seen_at có kiểm soát
- không kéo dài vô hạn

### Sensitive action
- step-up auth nếu cần
- rotate session sau xác minh lại

### Logout
- revoke session hiện tại
- xóa cookie

### Logout all devices
- revoke toàn bộ sessions đang hoạt động của user hoặc workspace context phù hợp

## Timeout

### Absolute timeout
Session hết hạn hoàn toàn sau thời gian cố định.

### Idle timeout
Session hết hạn nếu không hoạt động trong khoảng thời gian quy định.

Khuyến nghị nền:
- idle timeout vừa phải
- absolute timeout ngắn hơn cho admin-sensitive zones

## Session rotation

Bắt buộc rotate khi:
- login thành công
- đổi mật khẩu
- bật/tắt MFA
- step-up auth thành công
- nghi ngờ chiếm quyền

## Session binding nhẹ

Có thể lưu:
- ip_hash
- user_agent_hash

Không nên khóa cứng session chỉ theo IP, nhưng nên dùng để phát hiện rủi ro.

## Anti-abuse

- login rate limit
- failed attempt counters
- suspicious session event logging
- revoke all on compromise flow

## Cookie policy

- HttpOnly
- Secure
- SameSite=Lax mặc định
- domain/path rõ ràng
- không lưu dữ liệu nhạy cảm trong cookie ngoài session reference

## Điều cấm

- không lưu role authoritative chỉ ở client
- không dùng localStorage cho session auth chính
- không dùng session vô thời hạn
- không bỏ revoke server-side
