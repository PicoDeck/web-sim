-- Browser-test fixture, bundled only in test builds (make test): it counts its
-- boots in /data, which must survive a page reload, and records Enter presses,
-- which prove keys reach an app. Esc quits.
local pc = picocalc
local fs, input, disp = pc.fs, pc.input, pc.display
local DATA = "/data/" .. APP_ID

local function write(name, text)
    local f = fs.open(DATA .. "/" .. name, "w")
    if f then
        fs.write(f, text)
        fs.close(f)
    end
end

pcall(fs.mkdir, DATA)
local boots = (tonumber(fs.readFile(DATA .. "/boots.txt") or "0") or 0) + 1
write("boots.txt", tostring(boots))
disp.clear(disp.BLACK)
disp.drawText(10, 10, "web_test boot " .. boots, disp.WHITE)
disp.flush()

local presses = 0
while true do
    input.update()
    local pressed = input.getButtonsPressed()
    if pressed & input.BTN_ENTER ~= 0 then
        presses = presses + 1
        write("enter.txt", tostring(presses))
    end
    if pressed & input.BTN_ESC ~= 0 then return end
    pc.sys.sleep(20)
end
