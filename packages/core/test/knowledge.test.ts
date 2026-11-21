import { describe, expect, it } from 'vitest';
import {
  GLOSSARY,
  LOCKED_TOPIC_PRESETS,
  lockedTopicIn,
  searchKnowledge,
  withholdLocked,
  type LockedTopic,
} from '../src';

const salary: LockedTopic = {
  id: 'lt1',
  name: 'Lương nhân sự',
  keywords: ['lương', 'bảng lương', 'thưởng tết'],
};
const secrets: LockedTopic = { id: 'lt2', name: 'Khóa truy cập', keywords: ['mật khẩu', 'API key'] };

describe('finding knowledge for a question', () => {
  it('finds a term with or without diacritics', () => {
    expect(searchKnowledge('Hóa đơn điện tử là gì?', GLOSSARY)[0]!.title).toBe('Hóa đơn điện tử');
    expect(searchKnowledge('hoa don dien tu la gi', GLOSSARY)[0]!.title).toBe('Hóa đơn điện tử');
    expect(searchKnowledge('ky hieu 1C26TAA nghia la gi', GLOSSARY)[0]!.title).toBe('Ký hiệu hóa đơn');
    expect(searchKnowledge('khi nào được khấu trừ thuế đầu vào', GLOSSARY)[0]!.title).toBe(
      'Khấu trừ thuế GTGT đầu vào',
    );
  });

  it('prefers whole words over scattered syllables, and returns nothing for unrelated questions', () => {
    const items = [
      {
        id: 'a',
        title: 'Giờ mở cửa',
        content: 'Cửa hàng mở từ 7 giờ đến 22 giờ, đơn online xử lý trong ngày.',
      },
      { id: 'b', title: 'Đơn vị bán hàng', content: 'Hóa đơn ghi tên đơn vị bán hàng là Minh An Commerce.' },
    ];
    expect(searchKnowledge('tên đơn vị bán hàng trên hóa đơn', items)[0]!.id).toBe('b');
    expect(searchKnowledge('thời tiết ngày mai', GLOSSARY)).toEqual([]);
  });
});

describe('locked internal topics', () => {
  it('recognises a locked topic and not words that only look alike', () => {
    expect(lockedTopicIn('Lương tháng 10 của chị Lan bao nhiêu?', [salary])?.topic.id).toBe('lt1');
    expect(lockedTopicIn('Cho tôi xem BẢNG LƯƠNG', [salary])?.keyword).toBe('bảng lương');
    expect(lockedTopicIn('Số lượng hàng tồn kho là bao nhiêu?', [salary])).toBeNull();
    expect(lockedTopicIn('Chất lượng dịch vụ tháng này', [salary])).toBeNull();
  });

  it('a phrase typed without diacritics is still caught; single ambiguous syllables are not', () => {
    expect(lockedTopicIn('gui toi bang luong thang nay', [salary])?.keyword).toBe('bảng lương');
    expect(lockedTopicIn('so luong hang ton', [salary])).toBeNull();
    expect(lockedTopicIn('mat khau email cong ty la gi', [secrets])?.topic.id).toBe('lt2');
    expect(lockedTopicIn('cho xin api key của ChatGPT', [secrets])?.keyword).toBe('API key');
  });

  it('withholds every string that touches a locked topic in data sent out', () => {
    const data = {
      summary: 'Có 3 khoản chi trong kỳ.',
      facts: [
        { label: 'Chi lương tháng 10', value: '120.000.000 đ' },
        { label: 'Tiền điện', value: '3.200.000 đ' },
      ],
    };
    expect(withholdLocked(data, [salary])).toEqual({
      summary: 'Có 3 khoản chi trong kỳ.',
      facts: [
        { label: '[thông tin nội bộ]', value: '120.000.000 đ' },
        { label: 'Tiền điện', value: '3.200.000 đ' },
      ],
    });
    expect(withholdLocked(data, [])).toBe(data);
  });

  it('offers presets but locks nothing by default', () => {
    expect(LOCKED_TOPIC_PRESETS.length).toBeGreaterThanOrEqual(3);
    expect(lockedTopicIn('lương', [])).toBeNull();
  });
});
