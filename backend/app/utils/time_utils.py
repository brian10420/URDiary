from datetime import datetime, timedelta
import pytz

import config

# 應用的本地時區 (日記的「今天」以此為準)；由 URDIARY_TIMEZONE 設定，
# 無效值時退回 Asia/Taipei。注意：中途變更時區不會換算既有 diary_date。
try:
    LOCAL_TZ = pytz.timezone(config.TIMEZONE)
except pytz.UnknownTimeZoneError:
    print(f"⚠️  無效的時區設定 URDIARY_TIMEZONE={config.TIMEZONE}，退回 Asia/Taipei")
    LOCAL_TZ = pytz.timezone('Asia/Taipei')

# 日記換日的界線：預設凌晨 5 點前算前一天
DIARY_DAY_BOUNDARY_HOUR = config.DIARY_DAY_BOUNDARY_HOUR


def get_local_now():
    """回傳當前的本地時間 (帶時區)。

    容器內的 server local time 通常是 UTC，直接用 datetime.now() 會讓
    「今天」與日記的台北時間基準差 8 小時，因此所有和日記日期相關的判斷
    都應該經由這個函式取得基準時間。
    """
    return datetime.utcnow().replace(tzinfo=pytz.UTC).astimezone(LOCAL_TZ)


def get_diary_date():
    """
    获取日记日期，使用当地时间凌晨5点为界线
    如果当前时间在凌晨5点前，则日记归属于前一天
    """
    local_now = get_local_now()

    if local_now.hour < DIARY_DAY_BOUNDARY_HOUR:
        return local_now.date() - timedelta(days=1)

    return local_now.date()


def get_diary_datetime():
    """
    返回完整的日记日期时间对象，使用当地时间凌晨5点为界线

    注意：回傳的是「台北牆上時間」的 naive datetime (SQLAlchemy 的欄位為 naive)。
    與同一列的 created_at (UTC naive，來自 datetime.utcnow) 不同基準，
    比較 diary_date 時請一律用 get_local_now() 當基準。
    """
    diary_date = get_diary_date()
    local_now = get_local_now()

    # 用日記日期 + 當前本地時間組成 naive datetime
    return datetime.combine(diary_date, local_now.time())
