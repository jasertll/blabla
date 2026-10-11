// A small, fully local, zero-network fallback for the Password Breach
// Check — these are drawn from long-published, widely-cited password
// research (Mark Burnett's leaked-password frequency analysis, SplashData/
// NordPass's annual "worst passwords" lists, etc.), not fabricated. This
// is NOT a replacement for the live HaveIBeenPwned check (that covers
// billions of real breached password hashes; this list covers a few
// hundred of the most common ones) — it exists purely so the tool still
// gives a real, honest signal if pwnedpasswords.com is ever genuinely
// unreachable on a given network, instead of a dead end.
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(
  [
    "123456", "password", "12345678", "qwerty", "123456789", "12345", "1234", "111111",
    "1234567", "dragon", "123123", "baseball", "abc123", "football", "monkey", "letmein",
    "696969", "shadow", "master", "666666", "qwertyuiop", "123321", "mustang", "1234567890",
    "michael", "654321", "superman", "1qaz2wsx", "7777777", "121212", "000000", "qazwsx",
    "123qwe", "killer", "trustno1", "jordan", "jennifer", "zxcvbnm", "asdfgh", "hunter",
    "buster", "soccer", "harley", "batman", "andrew", "tigger", "sunshine", "iloveyou",
    "2000", "charlie", "robert", "thomas", "hockey", "ranger", "daniel", "starwars",
    "112233", "george", "computer", "michelle", "jessica", "pepper", "1111", "zxcvbn",
    "555555", "11111111", "131313", "freedom", "777777", "pass", "maggie", "159753",
    "aaaaaa", "ginger", "princess", "joshua", "cheese", "amanda", "summer", "love",
    "ashley", "6969", "nicole", "chelsea", "biteme", "matthew", "access", "yankees",
    "987654321", "dallas", "austin", "thunder", "taylor", "matrix", "mobilemail", "monitor",
    "hannah", "amanda", "loveme", "trustno1", "jasmine", "vanessa", "spider", "hardcore",
    "gemini", "creative", "sparky", "yellow", "sausage", "andrea", "chris", "boomer",
    "florida", "extreme", "gunner", "yankee1", "welcome", "admin", "root", "toor",
    "1q2w3e4r", "qwerty123", "1qazxsw2", "letmein123", "passw0rd", "password1", "p@ssw0rd",
    "abcd1234", "iloveu", "myspace1", "blink182", "fuckyou", "654321a", "222222", "888888",
    "999999", "asdfasdf", "qweqwe", "aaaa", "121212a", "qwe123", "1231234", "555666",
    "changeme", "default", "guest", "test123", "temp1234", "letme1n", "opensesame",
    "starwars1", "batman1", "pokemon", "minecraft", "fortnite", "footballer", "cricket11",
    "liverpool", "chelsea1", "arsenal", "manutd", "barcelona", "juventus", "madrid",
    "flower", "sunshine1", "butterfly", "angel", "cookie", "chocolate", "coffee",
    "baseball1", "basketball", "hockey1", "tennis", "golfer", "runner", "swimmer",
    "dolphin", "eagle1", "falcon", "phoenix1", "dragon1", "tiger1", "lion1", "panther",
    "wolf1", "bear1", "shark1", "cobra1", "viper1", "scorpion", "spider1", "phoenix",
    "newyork", "chicago", "boston", "houston", "phoenix2", "seattle", "atlanta", "denver",
    "12341234", "11223344", "13131313", "10101010", "19191919", "20202020", "aaaaaaaa",
    "bbbbbbbb", "zzzzzzzz", "asdasd", "qazqaz", "wsxwsx", "edcedc", "rfvrfv", "poipoi",
    "lkjlkj", "mnbmnb", "tyutyu", "ghjghj", "vbnvbn", "iuiuiu", "oioioi", "plplpl",
  ].map((p) => p.toLowerCase())
);

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}
