// Node 24 can fail in uv_os_get_passwd on some Windows accounts. Tools such as
// tsx only need a stable temporary-directory suffix, so expose the conventional
// non-Windows API before those tools initialize.
if (process.platform === "win32" && typeof process.geteuid !== "function") {
  process.geteuid = () => 0;

  const os = require("node:os");
  const originalUserInfo = os.userInfo;
  os.userInfo = (...args) => {
    try {
      return originalUserInfo(...args);
    } catch (error) {
      if (error?.code !== "ERR_SYSTEM_ERROR") throw error;
      return {
        uid: -1,
        gid: -1,
        username: process.env.USERNAME || "windows-user",
        homedir: process.env.USERPROFILE || process.cwd(),
        shell: null,
      };
    }
  };
}
