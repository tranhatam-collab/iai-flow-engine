# Incident Response Playbook

## Mục tiêu

Khi xảy ra sự cố, đội ngũ phải biết làm gì ngay lập tức. Không được xử lý tùy hứng.

## Các loại sự cố chính

1. Account takeover
2. Secret leakage
3. Workflow abuse / runaway execution
4. Suspicious admin action
5. Data exposure
6. Infrastructure compromise suspicion

## Quy trình 6 bước

### 1. Detect
Xác định dấu hiệu bất thường từ audit logs, user report hoặc monitoring.

### 2. Contain
Giảm thiệt hại ngay:
- revoke sessions
- disable workflow
- rotate secret
- kill execution
- lock workspace nếu cần

### 3. Assess
Xác định:
- ai bị ảnh hưởng
- tài nguyên nào bị ảnh hưởng
- mức độ lan rộng
- thời gian bắt đầu

### 4. Eradicate
Loại bỏ nguyên nhân:
- fix policy
- rotate credentials
- patch code
- remove malicious workflow

### 5. Recover
Khôi phục an toàn:
- reopen access có kiểm soát
- verify logs
- verify permissions
- verify runtime stability

### 6. Review
Viết post-incident review:
- nguyên nhân
- tác động
- thời gian phản ứng
- bài học
- hành động phòng ngừa

## Playbook ngắn theo loại sự cố

### Account takeover
- revoke all user sessions
- force password reset / step-up
- review audit logs
- notify affected workspace if needed

### Secret leakage
- rotate affected secret
- disable dependent workflows if needed
- review secret use events
- assess external abuse

### Runaway workflow
- kill run
- disable workflow
- inspect retry / loop cause
- patch runtime guardrail

### Suspicious admin action
- freeze admin-sensitive changes
- inspect recent role and secret changes
- require re-auth
- escalate review

## Thời gian phản ứng mục tiêu

- critical: phản ứng ngay
- warning: trong ngày
- info: theo batch review nếu phù hợp
