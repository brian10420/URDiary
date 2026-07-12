"""提示詞載入器：prompts/{lang}/{name}，找不到時退回 zh-TW。

取代原本散在 interaction_service / diary_service / analytics_service 的
三份 read_prompt_file()。不做快取：檔案極小，且不快取才能改完提示詞
立即生效 (uvicorn --reload 不監看 .txt)。
"""
import json
import logging
import os

logger = logging.getLogger(__name__)

PROMPTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts")
DEFAULT_LANG = "zh-TW"
SUPPORTED_LANGS = ("zh-TW", "en")

FALLBACK_PROMPT = "請根據對話歷史生成相應內容。"


def normalize_lang(lang) -> str:
    """把任意語言輸入正規化為支援的語言代碼。"""
    value = (lang or "").strip()
    low = value.lower()
    if low.startswith("en"):
        return "en"
    if low.startswith("zh") or value in SUPPORTED_LANGS:
        return "zh-TW"
    return DEFAULT_LANG


def load_prompt(name: str, lang: str = DEFAULT_LANG) -> str:
    """讀取提示詞模板；語言檔缺失時退回 zh-TW，再不行回安全佔位。"""
    lang = normalize_lang(lang)
    tried = []
    for candidate in dict.fromkeys((lang, DEFAULT_LANG)):
        path = os.path.join(PROMPTS_DIR, candidate, name)
        tried.append(path)
        try:
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            continue
        except Exception as e:
            logger.error(f"讀取提示詞 {path} 失敗: {e}")
    logger.error(f"提示詞 {name} 不存在 (tried: {tried})，使用安全佔位")
    return FALLBACK_PROMPT


def get_role(key: str, lang: str = DEFAULT_LANG) -> str:
    """取 system 角色短句 (roles.json)；缺項時退回通用陪伴者句。"""
    lang = normalize_lang(lang)
    for candidate in dict.fromkeys((lang, DEFAULT_LANG)):
        path = os.path.join(PROMPTS_DIR, candidate, "roles.json")
        try:
            with open(path, "r", encoding="utf-8") as f:
                roles = json.load(f)
            if key in roles:
                return roles[key]
        except FileNotFoundError:
            continue
        except Exception as e:
            logger.error(f"讀取 roles.json ({path}) 失敗: {e}")
    return "你是一位溫暖、有同理心的助手。"
