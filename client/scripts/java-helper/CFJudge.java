import java.io.*;
import java.lang.reflect.*;

public class CFJudge {
    /**
     * Loads the user's classes straight from their build directory.
     * URLClassLoader can't be used: it probes file: URLs in ways CheerpJ's
     * virtual file system doesn't support, so it never finds the class.
     */
    static final class DirLoader extends ClassLoader {
        private final String dir;
        DirLoader(String dir, ClassLoader parent) { super(parent); this.dir = dir.endsWith("/") ? dir : dir + "/"; }
        @Override protected Class<?> findClass(String name) throws ClassNotFoundException {
            InputStream in = null;
            try {
                in = new FileInputStream(dir + name.replace('.', '/') + ".class");
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                for (int n; (n = in.read(chunk)) > 0; ) buf.write(chunk, 0, n);
                byte[] b = buf.toByteArray();
                return defineClass(name, b, 0, b.length);
            } catch (IOException e) {
                throw new ClassNotFoundException(name, e);
            } finally {
                if (in != null) try { in.close(); } catch (IOException ignored) {}
            }
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length > 0 && args[0].equals("compile")) {
            // compile <javac args...> — creates the -d directory first (javac 8
            // refuses a missing one); diagnostics go to /files/__diag
            String[] j = new String[args.length - 1];
            System.arraycopy(args, 1, j, 0, j.length);
            for (int i = 0; i + 1 < j.length; i++) {
                if (j[i].equals("-d")) new File(j[i + 1]).mkdirs();
            }
            PrintWriter w = new PrintWriter(new OutputStreamWriter(
                new FileOutputStream("/files/__diag"), "UTF-8"));
            // reflective, so this helper builds with `javac --release 8` (the
            // javac API lives in tools.jar, served by the site as /app/tools.jar)
            Method compile;
            try {
                compile = Class.forName("com.sun.tools.javac.Main")
                    .getMethod("compile", String[].class, PrintWriter.class);
            } catch (Throwable missing) {
                w.println("javac is not available (tools.jar is missing): " + missing);
                w.flush(); w.close();
                System.exit(3);
                return;
            }
            int rc = (Integer) compile.invoke(null, (Object) j, w);
            w.flush(); w.close();
            System.exit(rc);
        }
        // run <ClassName> <stdinPath> <timeLimitMs> [classDir]
        final String cls = args[1];
        System.setIn(new FileInputStream(args[2]));
        final PrintStream out = new PrintStream(new BufferedOutputStream(
            new FileOutputStream("/files/__out"), 1 << 16), false, "UTF-8");
        final PrintStream err = new PrintStream(new FileOutputStream("/files/__err"), true, "UTF-8");
        System.setOut(out); System.setErr(err);
        Runtime.getRuntime().addShutdownHook(new Thread() {
            public void run() { out.flush(); err.flush(); }
        });
        long limit = 10000;
        try { limit = Long.parseLong(args[3]); } catch (Exception ignored) {}
        final long lim = limit + 500;
        Thread watchdog = new Thread() {
            public void run() {
                try { Thread.sleep(lim); } catch (InterruptedException e) { return; }
                out.flush(); err.flush();
                Runtime.getRuntime().halt(124);
            }
        };
        watchdog.setDaemon(true);
        watchdog.start();
        int code = 0;
        try {
            // The JVM's own class path is fixed when CheerpJ first starts, before
            // any submission was compiled, so load the user's class from its
            // build directory with a fresh class loader.
            Class<?> c;
            if (args.length > 4) {
                c = Class.forName(cls, true, new DirLoader(args[4], CFJudge.class.getClassLoader()));
            } else {
                c = Class.forName(cls);
            }
            Method m = c.getMethod("main", String[].class);
            m.setAccessible(true);
            m.invoke(null, (Object) new String[0]);
        } catch (InvocationTargetException e) {
            (e.getCause() == null ? e : e.getCause()).printStackTrace(err);
            code = 1;
        } catch (Throwable t) {
            t.printStackTrace(err);
            code = 1;
        }
        out.flush(); err.flush();
        System.exit(code);
    }
}
