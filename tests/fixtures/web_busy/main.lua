-- Browser-test fixture, bundled only in test builds (make test): a Lua loop
-- that never sleeps, flushes or polls input, so only the Lua count hook can
-- hand the tab back to the browser. It writes started.txt first, then sleeps
-- once (a yield, so the page can see the marker), then spins forever.
local pc = picocalc
local fs = pc.fs
local DATA = "/data/" .. APP_ID

pcall(fs.mkdir, DATA)
local f = fs.open(DATA .. "/started.txt", "w")
if f then
    fs.write(f, "1")
    fs.close(f)
end
pc.sys.sleep(500)

local x = 0
while true do
    x = x + 1
end
