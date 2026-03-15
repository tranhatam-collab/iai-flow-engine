# Identity Model

## Mục tiêu

Identity model định nghĩa ai là người dùng, họ thuộc workspace nào, có những vai trò gì và được nhận diện thế nào trong toàn hệ thống.

## Thực thể cốt lõi

### User
Một người dùng duy nhất trong hệ thống.

Trường tối thiểu:
- user_id
- email
- display_name
- status
- email_verified
- mfa_enabled
- created_at
- updated_at
- last_login_at

### Workspace
Đơn vị sở hữu tài nguyên.

Trường tối thiểu:
- workspace_id
- name
- slug
- status
- owner_user_id
- created_at
- updated_at

### Membership
Liên kết giữa user và workspace.

Trường tối thiểu:
- membership_id
- workspace_id
- user_id
- role
- status
- invited_by
- joined_at
- created_at
- updated_at

### Session
Phiên đăng nhập hợp lệ.

Trường tối thiểu:
- session_id
- user_id
- created_at
- expires_at
- revoked_at
- ip_hash
- user_agent_hash
- last_seen_at
- risk_level

## Trạng thái user

### active
Có thể sử dụng bình thường.

### pending
Chưa hoàn tất xác minh hoặc lời mời.

### suspended
Bị tạm khóa.

### disabled
Bị vô hiệu hóa hoàn toàn.

## Vai trò nền

### owner
Quyền cao nhất trong workspace.

### admin
Quản trị workspace nhưng không mặc định cao hơn owner.

### builder
Tạo và chỉnh flow.

### operator
Chạy, theo dõi và xử lý runtime.

### analyst
Xem dữ liệu, logs, metrics.

### viewer
Chỉ xem.

## Quy tắc nền

1. Một user có thể thuộc nhiều workspace.
2. Một workspace phải có ít nhất một owner.
3. Membership bị vô hiệu hóa thì mọi session trong workspace đó phải mất hiệu lực logic.
4. Email không đồng nghĩa với quyền.
5. Session không được xem là source of truth cho role nếu membership đã đổi.

## Yêu cầu xác thực danh tính

### Email verification
Cần cho tài khoản mới.

### MFA
Bắt buộc với owner và admin.
Khuyến nghị với operator.

### Step-up verification
Dùng cho hành động nhạy cảm:
- rotate secret
- change role
- remove owner
- export sensitive data
- revoke all sessions

## Khung đăng nhập an toàn

- cookie HttpOnly Secure
- SameSite=Lax hoặc stricter cho vùng nhạy cảm
- rotate session sau login
- rotate session sau step-up auth
- logout phải revoke session server-side

## Anti-abuse identity checks

- rate limit theo IP và email
- brute force detection
- suspicious login heuristics
- impossible travel có thể bổ sung sau
- revoke all active sessions khi có dấu hiệu compromise

## Identity invariants

1. user_id là bất biến
2. workspace_id là bất biến
3. owner không được xóa nếu workspace chưa có owner khác
4. membership là nguồn sự thật cho role trong workspace
5. session phải luôn gắn với user_id thực
