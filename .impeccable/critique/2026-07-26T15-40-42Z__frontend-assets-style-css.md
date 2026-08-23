---
target: frontend/assets/style.css
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-07-26T15-40-42Z
slug: frontend-assets-style-css
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Exam strip + timer + answer-strip tốt. Thiếu skeleton rõ ở quiz panel loading. |
| 2 | Match System / Real World | 3 | Tiếng Việt phù hợp. "Space" còn là jargon kỹ thuật. |
| 3 | User Control and Freedom | 2 | Không có undo khi khóa câu. Không có "quay lại setup" rõ ràng. |
| 4 | Consistency and Standards | 2 | 3-4 lớp token song song. Nhiều hardcoded hex chưa được override. setup-dashboard định nghĩa 2 lần. |
| 5 | Error Prevention | 3 | Confirm dialog trước nộp bài tốt. Thiếu validation tên/nhóm trống. |
| 6 | Recognition Rather Than Recall | 3 | Answer strip xuất sắc. Trên mobile strip bị ẩn khỏi viewport. |
| 7 | Flexibility and Efficiency | 1 | Không có keyboard shortcuts cho answer choices. |
| 8 | Aesthetic and Minimalist Design | 2 | Quiz panel tốt. Setup dashboard dùng purple/dark sidebar không thuộc design system. start-btn hardcoded red. |
| 9 | Error Recovery | 2 | Toast tồn tại nhưng thiếu recovery guidance cụ thể. |
| 10 | Help and Documentation | 1 | Không có contextual help. Người dùng không biết khác biệt Thi thử/Luyện tập. |
| Total | | 22/40 | Acceptable |

## Priority Issues

- [P1] start-btn hardcoded #dc2626 — màu đỏ sai tín hiệu cho action "Bắt đầu thi"
- [P1] CSS có 2 visual worlds song song — setup dashboard purple layer + exam-paper override layer
- [P2] side-tab antipattern: .review border-left và .leaderboard-row.top-rank inset stripe
- [P2] transition: width on progress bar causes layout thrash
- [P3] .large-question max-width: 30ch quá hẹp trên desktop
