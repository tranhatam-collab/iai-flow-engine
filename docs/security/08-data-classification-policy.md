# Data Classification Policy

## Mục tiêu

Không thể bảo mật tốt nếu mọi dữ liệu đều bị xem như nhau. Dữ liệu phải được phân loại để áp chính sách lưu trữ, truy cập, logging và export đúng mức.

## Các mức phân loại

### Public
Dữ liệu có thể công khai.

### Internal
Dữ liệu nội bộ, không nên công khai ra ngoài.

### Sensitive
Dữ liệu cần hạn chế truy cập, có thể gây rủi ro nếu lộ.

### Restricted
Dữ liệu tối nhạy cảm, chỉ một số ít thành phần hệ thống được chạm tới.

## Phân loại gợi ý

### Public
- tài liệu marketing công khai
- metadata public modules nếu có

### Internal
- workflow name
- workspace basic settings
- non-sensitive UI configs

### Sensitive
- runtime payloads
- logs có business context
- member lists
- audit context

### Restricted
- secrets
- MFA recovery materials
- encryption-related material
- privileged admin security events

## Ứng dụng chính sách

### Storage
Restricted và Sensitive cần chính sách lưu trữ chặt hơn.

### Access
Restricted cần role/scope cao hơn.

### Logging
Restricted không được log plaintext.

### Export
Restricted không được export trừ quy trình đặc biệt.

### Retention
Một số dữ liệu cần xóa hoặc rút gọn theo thời gian.

## Quy tắc nền

- nếu không chắc, classify cao hơn
- không hạ classification nếu chưa review
- data classification phải được phản ánh trong API, UI và logs
