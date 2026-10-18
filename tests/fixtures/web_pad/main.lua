-- Browser-test fixture, bundled only in test builds (make test): it records
-- what the gamepad and the typed characters see, so a test can tell a bound
-- key that still types from one that was remapped. A and B presses are
-- counted in a.txt and b.txt, the held buttons are in held.txt, every typed
-- character is appended to chars.txt, and label.txt / label_alt.txt name A's
-- two keys. Esc quits.
local pc = picocalc
local fs, input, gp, disp = pc.fs, pc.input, pc.gamepad, pc.display
local DATA = "/data/" .. APP_ID

local function write(name, text)
    local f = fs.open(DATA .. "/" .. name, "w")
    if f then
        fs.write(f, text)
        fs.close(f)
    end
end

pcall(fs.mkdir, DATA)
write("label.txt", gp.getLabel(gp.PAD_A) or "")
write("label_alt.txt", gp.getLabel(gp.PAD_A, 1) or "")
disp.clear(disp.BLACK)
disp.drawText(10, 10, "web_pad", disp.WHITE)
disp.flush()
write("ready.txt", "1")

local a, b, chars, held_was = 0, 0, "", nil
while true do
    input.update()
    local pressed = gp.getButtonsPressed()
    if pressed & gp.PAD_A ~= 0 then
        a = a + 1
        write("a.txt", tostring(a))
    end
    if pressed & gp.PAD_B ~= 0 then
        b = b + 1
        write("b.txt", tostring(b))
    end
    local held = gp.getButtons()
    if held ~= held_was then
        held_was = held
        write("held.txt", tostring(held))
    end
    local ev = input.pollEvent()
    while ev do
        if ev.type == "char" then
            chars = chars .. ev.char
            write("chars.txt", chars)
        end
        ev = input.pollEvent()
    end
    if input.getButtonsPressed() & input.BTN_ESC ~= 0 then return end
    pc.sys.sleep(20)
end
