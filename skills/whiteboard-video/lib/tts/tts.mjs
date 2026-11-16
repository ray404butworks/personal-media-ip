// 统一火山实现：音频与原生时间戳同次校验，失败停止，不切换备用声源。
export {synthesize,getDuration,normalizeText,validateAlignment,segmentStarts,parseVolcResponse} from './volc-http.mjs';
