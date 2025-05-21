from datetime import datetime, timedelta
import pytz

def get_diary_date():
    """
    获取日记日期，使用当地时间凌晨5点为界线
    如果当前时间在凌晨5点前，则日记归属于前一天
    """
    # 使用台湾时区（或您的本地时区）
    local_tz = pytz.timezone('Asia/Taipei')
    
    # 获取当前的UTC时间，然后转换到本地时区
    utc_now = datetime.utcnow().replace(tzinfo=pytz.UTC)
    local_now = utc_now.astimezone(local_tz)
    
    print(f"DEBUG: 当前UTC时间: {utc_now}, 本地时间: {local_now}, 本地小时: {local_now.hour}")
    
    # 如果当前时间在凌晨5点前，返回前一天的日期
    if local_now.hour < 5:
        return (local_now.date() - timedelta(days=1))
    
    # 否则返回当天日期
    return local_now.date()

def get_diary_datetime():
    """
    返回完整的日记日期时间对象，使用当地时间凌晨5点为界线
    """
    # 获取日记日期部分（考虑5点界限）
    diary_date = get_diary_date()
    
    # 获取当前的本地时间
    local_tz = pytz.timezone('Asia/Taipei')
    utc_now = datetime.utcnow().replace(tzinfo=pytz.UTC)
    local_now = utc_now.astimezone(local_tz)
    
    # 创建一个新的datetime对象，使用日记日期和当前时间
    result = datetime.combine(diary_date, local_now.time())
    # 确保结果是不带时区信息的naive datetime，因为SQLAlchemy默认使用naive datetime
    return result 